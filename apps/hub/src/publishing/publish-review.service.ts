import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PublishReviewDiffLine,
  PublishReviewFile,
  PublishReviewFileDetail,
  PublishReviewSummary,
} from '@nest/shared';
import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { diffLines } from 'diff';
import { promises as fs } from 'fs';
import * as path from 'path';
import { isDeepStrictEqual, promisify } from 'util';
import { gunzip, gzip } from 'zlib';
import { DatabaseService } from '../database/database.service';
import { HubRuntimeConfig } from '../hub.config';
import { sortSemVerDesc } from '../packs/semver';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

type ArtifactFile = PublishReviewFile & {
  old_text_file: string | null;
  new_text_file: string | null;
  old_image_file: string | null;
  new_image_file: string | null;
};

type ReviewArtifact = {
  schema_version: 1;
  request_id: string;
  pack_id: string;
  base_version: string | null;
  created_at: string;
  summary: PublishReviewSummary;
  files: ArtifactFile[];
};

type BuiltArtifact = {
  artifactPath: string;
  baseVersion: string | null;
  meaningfulChangedFiles: number;
};

type ArtifactImage = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

type ReviewArtifactView = {
  baseVersion: string | null;
  summary: PublishReviewSummary;
  files: PublishReviewFile[];
};

@Injectable()
export class PublishReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: HubRuntimeConfig,
  ) {}

  async build(
    requestId: string,
    packId: string,
    zipBytes: Buffer,
    frozenBaseVersion?: string | null,
  ): Promise<BuiltArtifact> {
    const candidate = this.readZipFiles(zipBytes, packId);
    const baseVersion =
      frozenBaseVersion === undefined
        ? this.latestBaseVersion(packId)
        : frozenBaseVersion;
    const baseline = await this.readBaseline(packId, baseVersion);
    const artifactPath = path.join(
      this.config.value.stagingPath,
      'review-artifacts',
      requestId,
    );
    await fs.rm(artifactPath, { recursive: true, force: true });
    await fs.mkdir(artifactPath, { recursive: true });

    try {
      const files: ArtifactFile[] = [];
      let meaningfulChangedFiles = 0;
      const allPaths = [
        ...new Set([...baseline.keys(), ...candidate.keys()]),
      ].sort((a, b) => a.localeCompare(b));
      for (const filePath of allPaths) {
        const oldBuffer = baseline.get(filePath) ?? null;
        const newBuffer = candidate.get(filePath) ?? null;
        const oldHash = oldBuffer ? sha256(oldBuffer) : null;
        const newHash = newBuffer ? sha256(newBuffer) : null;
        if (oldHash === newHash) continue;
        if (isMeaningfulChange(filePath, oldBuffer, newBuffer)) {
          meaningfulChangedFiles += 1;
        }
        files.push(
          await this.persistChangedFile(
            artifactPath,
            files.length,
            filePath,
            oldBuffer,
            newBuffer,
          ),
        );
      }

      const summary = summarize(files);
      const artifact: ReviewArtifact = {
        schema_version: 1,
        request_id: requestId,
        pack_id: packId,
        base_version: baseVersion,
        created_at: new Date().toISOString(),
        summary,
        files,
      };
      await fs.writeFile(
        path.join(artifactPath, 'manifest.json'),
        JSON.stringify(artifact),
        'utf8',
      );
      return {
        artifactPath,
        baseVersion,
        meaningfulChangedFiles,
      };
    } catch (error) {
      await fs.rm(artifactPath, { recursive: true, force: true });
      throw error;
    }
  }

  async manifest(artifactPath: string): Promise<ReviewArtifact> {
    const safePath = this.assertArtifactPath(artifactPath);
    try {
      const raw = await fs.readFile(
        path.join(safePath, 'manifest.json'),
        'utf8',
      );
      const artifact = JSON.parse(raw) as ReviewArtifact;
      if (artifact.schema_version !== 1 || !Array.isArray(artifact.files)) {
        throw new Error('Unsupported review artifact');
      }
      return artifact;
    } catch {
      throw new NotFoundException('Review diff is unavailable');
    }
  }

  async view(artifactPath: string): Promise<ReviewArtifactView> {
    const artifact = await this.manifest(artifactPath);
    return {
      baseVersion: artifact.base_version,
      summary: artifact.summary,
      files: artifact.files.map((file) => ({
        path: file.path,
        status: file.status,
        kind: file.kind,
        old_size: file.old_size,
        new_size: file.new_size,
        old_sha256: file.old_sha256,
        new_sha256: file.new_sha256,
        additions: file.additions,
        deletions: file.deletions,
        inline_available: file.inline_available,
        inline_unavailable_reason: file.inline_unavailable_reason,
      })),
    };
  }

  async fileDetail(
    artifactPath: string,
    requestedPath: string,
  ): Promise<PublishReviewFileDetail> {
    const artifact = await this.manifest(artifactPath);
    const file = this.findFile(artifact, requestedPath);
    if (file.kind === 'text' && file.inline_available) {
      const [oldText, newText] = await Promise.all([
        this.readCompressedText(artifactPath, file.old_text_file),
        this.readCompressedText(artifactPath, file.new_text_file),
      ]);
      return {
        kind: 'text',
        path: file.path,
        lines: unifiedLines(oldText ?? '', newText ?? ''),
      };
    }
    if (file.kind === 'image') {
      return {
        kind: 'image',
        path: file.path,
        old_available: Boolean(file.old_image_file),
        new_available: Boolean(file.new_image_file),
      };
    }
    return {
      kind: 'binary',
      path: file.path,
      reason:
        file.inline_unavailable_reason ??
        'This file type does not support an inline diff.',
    };
  }

  async image(
    artifactPath: string,
    requestedPath: string,
    side: string,
  ): Promise<ArtifactImage> {
    if (side !== 'old' && side !== 'new') {
      throw new BadRequestException('side must be old or new');
    }
    const artifact = await this.manifest(artifactPath);
    const file = this.findFile(artifact, requestedPath);
    if (file.kind !== 'image') {
      throw new NotFoundException('Image preview not found');
    }
    const storedName =
      side === 'old' ? file.old_image_file : file.new_image_file;
    if (!storedName) throw new NotFoundException('Image preview not found');
    const safeArtifactPath = this.assertArtifactPath(artifactPath);
    const buffer = await fs.readFile(path.join(safeArtifactPath, storedName));
    const extension = path.extname(file.path).toLowerCase();
    return {
      buffer,
      contentType: IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream',
      filename: path.basename(file.path),
    };
  }

  private latestBaseVersion(packId: string): string | null {
    const rows = this.database.db
      .prepare('SELECT version, yanked FROM releases WHERE pack_id = ?')
      .all(packId) as Array<{ version: string; yanked: number }>;
    if (rows.length === 0) return null;
    const installable = rows.filter((row) => row.yanked === 0);
    const pool = installable.length ? installable : rows;
    return sortSemVerDesc(pool.map((row) => row.version))[0] ?? null;
  }

  private async readBaseline(
    packId: string,
    baseVersion: string | null,
  ): Promise<Map<string, Buffer>> {
    if (!baseVersion) return new Map();
    const root = path.join(this.config.value.registryPath, packId, baseVersion);
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new NotFoundException(
        `Base release files are missing: ${packId}@${baseVersion}`,
      );
    }
    const files = new Map<string, Buffer>();
    await walkDirectory(root, root, files);
    return files;
  }

  private readZipFiles(zipBytes: Buffer, packId: string): Map<string, Buffer> {
    const zip = new AdmZip(zipBytes);
    const prefix = `${packId}/`;
    const files = new Map<string, Buffer>();
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const normalized = entry.entryName.replaceAll('\\', '/');
      if (!normalized.startsWith(prefix)) {
        throw new BadRequestException('ZIP contents do not match the pack ID');
      }
      const relative = normalizeRelativePath(normalized.slice(prefix.length));
      if (!relative) continue;
      if (files.has(relative)) {
        throw new BadRequestException(
          `ZIP contains duplicate file: ${relative}`,
        );
      }
      files.set(relative, entry.getData());
    }
    return files;
  }

  private async persistChangedFile(
    artifactPath: string,
    index: number,
    filePath: string,
    oldBuffer: Buffer | null,
    newBuffer: Buffer | null,
  ): Promise<ArtifactFile> {
    const status = oldBuffer ? (newBuffer ? 'modified' : 'deleted') : 'added';
    const oldText = decodeInlineText(oldBuffer);
    const newText = decodeInlineText(newBuffer);
    const textCandidate =
      (oldBuffer == null || oldText.available) &&
      (newBuffer == null || newText.available);
    const extension = path.extname(filePath).toLowerCase();
    const imageCandidate = Boolean(IMAGE_CONTENT_TYPES[extension]);

    let kind: ArtifactFile['kind'] = 'binary';
    let additions: number | null = null;
    let deletions: number | null = null;
    let oldTextFile: string | null = null;
    let newTextFile: string | null = null;
    let oldImageFile: string | null = null;
    let newImageFile: string | null = null;
    let inlineAvailable = false;
    let unavailableReason: string | null =
      'This file type does not support an inline diff.';

    if (imageCandidate) {
      kind = 'image';
      inlineAvailable = true;
      unavailableReason = null;
      if (oldBuffer) {
        oldImageFile = `images/${index}-old${extension}`;
        await writeBuffer(path.join(artifactPath, oldImageFile), oldBuffer);
      }
      if (newBuffer) {
        newImageFile = `images/${index}-new${extension}`;
        await writeBuffer(path.join(artifactPath, newImageFile), newBuffer);
      }
    } else if (textCandidate) {
      kind = 'text';
      inlineAvailable = true;
      unavailableReason = null;
      const counts = lineCounts(oldText.value ?? '', newText.value ?? '');
      additions = counts.additions;
      deletions = counts.deletions;
      if (oldBuffer) {
        oldTextFile = `text/${index}-old.txt.gz`;
        await writeGzip(
          path.join(artifactPath, oldTextFile),
          oldText.value ?? '',
        );
      }
      if (newBuffer) {
        newTextFile = `text/${index}-new.txt.gz`;
        await writeGzip(
          path.join(artifactPath, newTextFile),
          newText.value ?? '',
        );
      }
    } else if (oldText.tooLarge || newText.tooLarge) {
      unavailableReason = 'Text file exceeds the 2 MiB inline diff limit.';
    }

    return {
      path: filePath,
      status,
      kind,
      old_size: oldBuffer?.length ?? null,
      new_size: newBuffer?.length ?? null,
      old_sha256: oldBuffer ? sha256(oldBuffer) : null,
      new_sha256: newBuffer ? sha256(newBuffer) : null,
      additions,
      deletions,
      inline_available: inlineAvailable,
      inline_unavailable_reason: unavailableReason,
      old_text_file: oldTextFile,
      new_text_file: newTextFile,
      old_image_file: oldImageFile,
      new_image_file: newImageFile,
    };
  }

  private findFile(
    artifact: ReviewArtifact,
    requestedPath: string,
  ): ArtifactFile {
    const normalized = normalizeRelativePath(requestedPath);
    const file = artifact.files.find((item) => item.path === normalized);
    if (!file) throw new NotFoundException('Changed file not found');
    return file;
  }

  private async readCompressedText(
    artifactPath: string,
    storedName: string | null,
  ): Promise<string | null> {
    if (!storedName) return null;
    const safePath = this.assertArtifactPath(artifactPath);
    const compressed = await fs.readFile(path.join(safePath, storedName));
    return (await gunzipAsync(compressed)).toString('utf8');
  }

  private assertArtifactPath(artifactPath: string): string {
    const root = path.resolve(
      this.config.value.stagingPath,
      'review-artifacts',
    );
    const resolved = path.resolve(artifactPath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new BadRequestException('Invalid review artifact path');
    }
    return resolved;
  }
}

/**
 * The managed root manifest remains visible in review, but a version-only
 * edit is packaging bookkeeping rather than a publishable pack change.
 * `path` is also ignored because it is an optional alias validated to equal
 * the immutable pack id.
 */
function isMeaningfulChange(
  filePath: string,
  oldBuffer: Buffer | null,
  newBuffer: Buffer | null,
): boolean {
  if (filePath.toLowerCase() !== 'pack.json' || !oldBuffer || !newBuffer) {
    return true;
  }
  try {
    const normalize = (buffer: Buffer) => {
      const manifest = JSON.parse(buffer.toString('utf8')) as Record<
        string,
        unknown
      >;
      delete manifest.version;
      delete manifest.path;
      return manifest;
    };
    return !isDeepStrictEqual(normalize(oldBuffer), normalize(newBuffer));
  } catch {
    return !oldBuffer.equals(newBuffer);
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.split('/').some((part) => !part || part === '..')
  ) {
    throw new BadRequestException('Invalid review file path');
  }
  return normalized;
}

async function walkDirectory(
  root: string,
  current: string,
  output: Map<string, Buffer>,
): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(root, absolute, output);
    } else if (entry.isFile()) {
      output.set(
        path.relative(root, absolute).split(path.sep).join('/'),
        await fs.readFile(absolute),
      );
    }
  }
}

function decodeInlineText(buffer: Buffer | null): {
  available: boolean;
  tooLarge: boolean;
  value: string | null;
} {
  if (!buffer) return { available: true, tooLarge: false, value: null };
  if (buffer.length > MAX_INLINE_TEXT_BYTES) {
    return { available: false, tooLarge: true, value: null };
  }
  if (buffer.includes(0)) {
    return { available: false, tooLarge: false, value: null };
  }
  try {
    return {
      available: true,
      tooLarge: false,
      value: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    };
  } catch {
    return { available: false, tooLarge: false, value: null };
  }
}

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function lineCounts(oldText: string, newText: string) {
  let additions = 0;
  let deletions = 0;
  for (const change of diffLines(oldText, newText)) {
    const count = splitLines(change.value).length;
    if (change.added) additions += count;
    if (change.removed) deletions += count;
  }
  return { additions, deletions };
}

function unifiedLines(
  oldText: string,
  newText: string,
): PublishReviewDiffLine[] {
  const lines: PublishReviewDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of diffLines(oldText, newText)) {
    for (const content of splitLines(change.value)) {
      if (change.added) {
        lines.push({
          type: 'added',
          old_line: null,
          new_line: newLine++,
          content,
        });
      } else if (change.removed) {
        lines.push({
          type: 'deleted',
          old_line: oldLine++,
          new_line: null,
          content,
        });
      } else {
        lines.push({
          type: 'context',
          old_line: oldLine++,
          new_line: newLine++,
          content,
        });
      }
    }
  }
  return lines;
}

function summarize(files: PublishReviewFile[]): PublishReviewSummary {
  return {
    changed_files: files.length,
    added_files: files.filter((file) => file.status === 'added').length,
    modified_files: files.filter((file) => file.status === 'modified').length,
    deleted_files: files.filter((file) => file.status === 'deleted').length,
    additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
  };
}

async function writeGzip(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, await gzipAsync(Buffer.from(value, 'utf8')));
}

async function writeBuffer(filePath: string, value: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

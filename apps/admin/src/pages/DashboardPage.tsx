import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Package, Upload, Users } from "lucide-react";
import { Metric } from "../components/Metric";
import { Progress } from "../components/Progress";
import { Badge, Card, Empty, ErrorBox, RefreshButton } from "../components/ui";
import { adminQueryKeys } from "../lib/api";
import { useAdminPacks, useAdminReviews, useAdminUsers } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

export function DashboardPage() {
  const qc = useQueryClient();
  const users = useAdminUsers();
  const reviews = useAdminReviews();
  const packs = useAdminPacks();
  const dataError = users.error ?? reviews.error ?? packs.error;
  const restricted =
    packs.data?.filter((p) => p.visibility === "restricted").length ?? 0;
  const releases =
    packs.data?.reduce((sum, pack) => sum + pack.releases.length, 0) ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Overview"
        description="Monitor review activity, knowledge packs, releases, and registered users."
        actions={
          <RefreshButton
            onClick={() => {
              void qc.invalidateQueries({ queryKey: adminQueryKeys.users });
              void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
              void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
            }}
            busy={users.isFetching || reviews.isFetching || packs.isFetching}
          />
        }
      />
      {dataError && <ErrorBox error={dataError} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Awaiting review"
          value={reviews.data?.length}
          icon={<BellRing />}
          tone="amber"
          loading={reviews.isLoading}
        />
        <Metric
          label="Knowledge packs"
          value={packs.data?.length}
          icon={<Package />}
          loading={packs.isLoading}
        />
        <Metric
          label="Published releases"
          value={releases}
          icon={<Upload />}
          loading={packs.isLoading}
        />
        <Metric
          label="Registered users"
          value={users.data?.length}
          icon={<Users />}
          tone="stone"
          loading={users.isLoading}
        />
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Review queue
              </h2>
              <p className="text-sm text-muted-foreground">
                Pending community submissions.
              </p>
            </div>
            <Link
              to="/reviews"
              className="text-sm font-medium text-primary hover:underline"
            >
              View queue
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {reviews.data?.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.pack_id}@{item.version} · @{item.submitter_id}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm text-foreground">
                    {item.commit_message ||
                      "No publish commit message provided."}
                  </p>
                </div>
                <Badge>Pending</Badge>
              </div>
            ))}
            {reviews.data?.length === 0 && (
              <Empty
                compact
                title="Queue clear"
                body="No submissions need review."
              />
            )}
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold tracking-tight">
            Access posture
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.data?.length ?? 0} registered users
          </p>
          <div className="mt-5 space-y-4">
            <Progress
              label="Public packs"
              value={(packs.data?.length ?? 0) - restricted}
              total={packs.data?.length ?? 0}
            />
            <Progress
              label="Restricted packs"
              value={restricted}
              total={packs.data?.length ?? 0}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

import { Link } from "@tanstack/react-router";
import { BellRing, EyeOff, Package, Upload } from "lucide-react";
import { Metric } from "../components/Metric";
import { Progress } from "../components/Progress";
import { Badge, Card, Empty } from "../components/ui";
import { useAdminData } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

export function DashboardPage() {
  const { users, reviews, packs } = useAdminData();
  const restricted =
    packs.data?.filter((p) => p.visibility === "restricted").length ?? 0;
  const releases =
    packs.data?.reduce((sum, pack) => sum + pack.releases.length, 0) ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Superuser administration"
        title="Good governance, at a glance."
        description="Review what needs attention and keep the shared knowledge catalog healthy."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Awaiting review"
          value={reviews.data?.length}
          icon={<BellRing />}
          tone="amber"
        />
        <Metric
          label="Knowledge packs"
          value={packs.data?.length}
          icon={<Package />}
        />
        <Metric label="Published releases" value={releases} icon={<Upload />} />
        <Metric
          label="Restricted packs"
          value={restricted}
          icon={<EyeOff />}
          tone="stone"
        />
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-xl">Review queue</h2>
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
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.pack_id}@{item.version} · @{item.submitter_id}
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
          <h2 className="font-serif text-xl">Access posture</h2>
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

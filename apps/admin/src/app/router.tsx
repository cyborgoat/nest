import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AdminLayout } from "../layout/AdminLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { PackDetailPage } from "../pages/PackDetailPage";
import { PacksPage } from "../pages/PacksPage";
import { ReviewsPage } from "../pages/ReviewsPage";
import { UsersPage } from "../pages/UsersPage";

const rootRoute = createRootRoute({ component: AdminLayout });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsPage,
});
const packsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packs",
  component: PacksPage,
});
const packRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packs/$packId",
  component: PackDetailPage,
});
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  component: UsersPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    dashboardRoute,
    reviewsRoute,
    packsRoute,
    packRoute,
    usersRoute,
  ]),
  basepath: "/admin",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

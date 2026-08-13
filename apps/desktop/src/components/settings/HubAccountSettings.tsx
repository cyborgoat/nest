import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Cloud,
  KeyRound,
  LogIn,
  LogOut,
  Save,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import {
  passwordsConfirmed,
  passwordsMismatch,
} from "@/lib/password-confirmation";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

export function AccountPanel() {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t("account.title")}
        description={t("account.description")}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl px-6 py-5">
          <HubAccountSettings />
        </div>
      </ScrollArea>
    </div>
  );
}

function HubAccountSettings() {
  const queryClient = useQueryClient();
  const openHubSettingsTab = useUiStore((state) => state.openHubSettingsTab);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const auth = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settingsGet,
  });
  const hubConfigured = Boolean(settings.data?.hub_base_url?.trim());
  useEffect(() => {
    if (auth.data?.user) setProfileName(auth.data.user.name);
  }, [auth.data?.user]);
  const accountManaged = auth.data?.user?.managed === true;

  const refreshIdentity = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.hubAuth }),
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
      queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
    ]);
  };
  const logout = useMutation({
    mutationFn: api.hubLogout,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.messages });
      queryClient.setQueryData(queryKeys.messageCount, { count: 0 });
      await refreshIdentity();
      toast.success("Signed out of Nest Hub");
    },
  });
  const updateProfile = useMutation({
    mutationFn: () => api.hubUpdateProfile(profileName),
    onSuccess: async (user) => {
      queryClient.setQueryData(queryKeys.hubAuth, {
        authenticated: true,
        user,
      });
      await refreshIdentity();
      toast.success("Profile name updated");
    },
    onError: (error: unknown) =>
      toast.error("Could not update profile", {
        description: appErrorMessage(error),
      }),
  });

  let accountContent;
  if (auth.isLoading || (!auth.data?.authenticated && settings.isLoading)) {
    accountContent = (
      <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Checking account…
      </div>
    );
  } else if (auth.error || (!auth.data?.authenticated && settings.error)) {
    const error = auth.error ?? settings.error;
    accountContent = (
      <EmptyState
        className="min-h-[360px]"
        icon={<CircleAlert className="size-7 text-destructive" />}
        title="Account status is unavailable"
        description={appErrorMessage(error)}
        footnote="Your local library remains available while Hub is unavailable."
      >
        <Button
          disabled={auth.isFetching || settings.isFetching}
          onClick={() => void Promise.all([auth.refetch(), settings.refetch()])}
        >
          {(auth.isFetching || settings.isFetching) && <Spinner />}
          Try again
        </Button>
      </EmptyState>
    );
  } else if (auth.data?.authenticated && auth.data.user) {
    accountContent = (
      <div className="space-y-7">
        <section className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-4 py-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-info/10 text-info">
            <UserRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {auth.data.user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {auth.data.user.id}
            </p>
          </div>
          <Badge variant="muted" className="capitalize">
            {auth.data.user.role}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </section>

        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Profile</h3>
            <p className="text-xs text-muted-foreground">
              Manage how your Nest identity appears across Hub.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-id">Account ID</Label>
            <Input id="account-id" value={auth.data.user.id} disabled />
            <p className="text-xs text-muted-foreground">
              Account IDs cannot be changed.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Display name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="profile-name"
                value={profileName}
                maxLength={100}
                disabled={accountManaged}
                onChange={(event) => setProfileName(event.target.value)}
              />
              <Button
                type="button"
                className="shrink-0"
                disabled={
                  updateProfile.isPending ||
                  accountManaged ||
                  !profileName.trim() ||
                  profileName.trim() === auth.data.user.name
                }
                onClick={() => updateProfile.mutate()}
              >
                <Save className="size-4" />
                Save changes
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {accountManaged
                ? "This account is managed by the Hub environment configuration."
                : "Used everywhere your Nest identity is displayed."}
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Security</h3>
            <p className="text-xs text-muted-foreground">
              Keep your Hub credentials and active sessions secure.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Password</p>
              <p className="text-xs text-muted-foreground">
                {accountManaged
                  ? "The Hub environment configuration locks this password."
                  : "Change your password and revoke older sessions."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={accountManaged}
              onClick={() => setPasswordOpen(true)}
            >
              <KeyRound className="size-4" />
              Change password
            </Button>
          </div>
        </section>
      </div>
    );
  } else if (!hubConfigured) {
    accountContent = (
      <EmptyState
        className="min-h-[360px]"
        icon={<Cloud className="size-7 text-amber-700" />}
        title="Connect a Hub before signing in"
        description="Add your team's Hub URL so Nest knows where to authenticate your account."
        footnote="An account is optional for local packs and public downloads."
      >
        <Button onClick={openHubSettingsTab}>Configure Hub</Button>
      </EmptyState>
    );
  } else {
    accountContent = (
      <EmptyState
        className="min-h-[360px]"
        icon={<UserRound className="size-7 text-info" />}
        title="Sign in to Nest Hub"
        description="Sign in or create an account to publish packs and access restricted knowledge."
        footnote="Your local library remains fully available without an account."
      >
        <Button onClick={() => setDialogOpen(true)}>
          <LogIn className="size-4" />
          Sign in or create account
        </Button>
      </EmptyState>
    );
  }

  return (
    <section className="space-y-6">
      {accountContent}
      <HubAuthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAuthenticated={refreshIdentity}
      />
      <PasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onChanged={refreshIdentity}
      />
    </section>
  );
}

function PasswordDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const change = useMutation({
    mutationFn: () => api.hubChangePassword(currentPassword, newPassword),
    onSuccess: async () => {
      await onChanged();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onOpenChange(false);
      toast.success("Password changed");
    },
  });
  const mismatch = passwordsMismatch(newPassword, confirmPassword);
  const confirmed = passwordsConfirmed(newPassword, confirmPassword);
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      change.reset();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    onOpenChange(nextOpen);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Your Hub defines the password requirements. Other signed-in sessions
            will be revoked.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (currentPassword && confirmed) change.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
              required
            />
            {mismatch && (
              <p className="text-xs text-destructive">
                The new passwords do not match.
              </p>
            )}
          </div>
          {Boolean(change.error) && (
            <div
              role="alert"
              className="rounded-r-md border-l-2 border-destructive bg-destructive/[0.08] px-3 py-2 text-xs text-destructive"
            >
              {appErrorMessage(change.error)}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              change.isPending || !currentPassword || !confirmed
            }
          >
            {change.isPending ? "Changing password…" : "Change password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HubAuthDialog({
  open,
  onOpenChange,
  onAuthenticated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const login = useMutation({
    mutationFn: () => api.hubLogin(id, password),
    onSuccess: async () => {
      setPassword("");
      await onAuthenticated();
      onOpenChange(false);
      toast.success("Signed in to Nest Hub");
    },
  });
  const register = useMutation({
    mutationFn: () => api.hubRegister(id, password, name),
    onSuccess: async () => {
      setPassword("");
      setConfirmPassword("");
      await onAuthenticated();
      onOpenChange(false);
      toast.success("Nest Hub account created");
    },
  });
  const busy = login.isPending || register.isPending;
  const error = login.error || register.error;
  const confirmationMismatch = passwordsMismatch(password, confirmPassword);
  const registrationPasswordConfirmed = passwordsConfirmed(
    password,
    confirmPassword,
  );
  const changeMode = (value: string) => {
    setMode(value as "login" | "register");
    login.reset();
    register.reset();
    setConfirmPassword("");
  };
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      login.reset();
      register.reset();
      setPassword("");
      setConfirmPassword("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nest Hub account</DialogTitle>
            <DialogDescription>
              Accounts are only needed for publishing and restricted packs.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList className="h-auto w-full justify-start gap-5 rounded-none border-b bg-transparent p-0">
              <TabsTrigger
                value="login"
                className="rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <LogIn className="size-4" /> Sign in
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <UserPlus className="size-4" /> Create account
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (mode === "login") login.mutate();
              else if (registrationPasswordConfirmed) register.mutate();
            }}
          >
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="hub-name">Display name</Label>
                <Input
                  id="hub-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="hub-id">Account ID</Label>
              <Input
                id="hub-id"
                value={id}
                onChange={(event) => setId(event.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hub-password">Password</Label>
              <Input
                id="hub-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
              {mode === "register" && (
                <p className="text-xs text-muted-foreground">
                  Password requirements are configured by your Hub service.
                </p>
              )}
              {mode === "login" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline"
                  onClick={() => setForgotOpen(true)}
                >
                  Forgot password?
                </Button>
              )}
            </div>
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="hub-confirm-password">Confirm password</Label>
                <Input
                  id="hub-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  autoComplete="new-password"
                  aria-invalid={confirmationMismatch}
                  required
                />
                {confirmationMismatch && (
                  <p className="text-xs text-destructive">
                    The passwords do not match.
                  </p>
                )}
              </div>
            )}
            {Boolean(error) && (
              <div
                role="alert"
                className="rounded-r-md border-l-2 border-destructive bg-destructive/[0.08] px-3 py-2 text-xs text-destructive"
              >
                {appErrorMessage(error)}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                (mode === "register" && !registrationPasswordConfirmed)
              }
            >
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </>
  );
}

function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Forgot your password?</DialogTitle>
          <DialogDescription>
            Nest Hub accounts don&apos;t support self-service password resets.
            Contact your Hub administrator and ask them to reset your password
            from the admin dashboard.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

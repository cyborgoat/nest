import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  LogIn,
  LogOut,
  Save,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";

export function HubAccountSettings() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const auth = useQuery({ queryKey: queryKeys.hubAuth, queryFn: api.hubAuthState });
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

  return (
    <section className="space-y-6">
      <div className="space-y-6">
        {auth.data?.authenticated && auth.data.user ? (
          <>
            <div className="flex items-center justify-end gap-2">
              <Badge variant="muted" className="capitalize">
                {auth.data.user.role}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut className="size-4" /> Sign out
              </Button>
            </div>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="account-id">Account ID</Label>
                <Input id="account-id" value={auth.data.user.id} disabled />
                <p className="text-xs text-muted-foreground">
                  Account IDs cannot be changed.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Display name</Label>
                <div className="flex gap-2">
                  <Input
                    id="profile-name"
                    value={profileName}
                    maxLength={100}
                    disabled={accountManaged}
                    onChange={(event) => setProfileName(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={
                      updateProfile.isPending ||
                      accountManaged ||
                      !profileName.trim() ||
                      profileName.trim() === auth.data.user.name
                    }
                    onClick={() => updateProfile.mutate()}
                  >
                    <Save className="size-4" />
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {accountManaged
                    ? "This account is managed by the Hub environment configuration."
                    : "Used everywhere your Nest identity is displayed."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
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
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Not signed in</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your local library remains fully available without an account.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <LogIn className="size-4" /> Sign in or create account
            </Button>
          </div>
        )}
      </div>
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
  const mismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;
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
            if (!mismatch) change.mutate();
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
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {appErrorMessage(change.error)}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              change.isPending ||
              mismatch ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
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
      await onAuthenticated();
      onOpenChange(false);
      toast.success("Nest Hub account created");
    },
  });
  const busy = login.isPending || register.isPending;
  const error = login.error || register.error;
  const changeMode = (value: string) => {
    setMode(value as "login" | "register");
    login.reset();
    register.reset();
  };
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      login.reset();
      register.reset();
      setPassword("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nest Hub account</DialogTitle>
          <DialogDescription>
            Accounts are only needed for publishing and restricted packs.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={changeMode}>
          <TabsList className="grid h-11 w-full grid-cols-2 bg-muted/80">
            <TabsTrigger
              value="login"
              className="h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
            >
              <LogIn className="size-4" /> Sign in
            </TabsTrigger>
            <TabsTrigger
              value="register"
              className="h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
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
            else register.mutate();
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
          </div>
          {Boolean(error) && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {appErrorMessage(error)}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const { loginMutation, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) {
    navigate(user.role === "admin" ? "/admin" : "/download");
    return null;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const u = await loginMutation.mutateAsync({ username, password });
      navigate(u.role === "admin" ? "/admin" : "/download");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <Card className="w-full max-w-sm border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="w-5 h-5 text-primary" />
            <CardTitle className="font-mono tracking-widest text-lg">
              NEXUS//ACCESS
            </CardTitle>
          </div>
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Authenticate to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="font-mono text-xs uppercase">
                Username
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-mono text-xs uppercase">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="font-mono"
              />
            </div>
            {error && (
              <p className="text-xs font-mono text-destructive">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full font-mono uppercase tracking-widest"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "AUTHENTICATING…" : "LOGIN"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

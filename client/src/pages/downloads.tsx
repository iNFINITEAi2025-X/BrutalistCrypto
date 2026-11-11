import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Download, LogOut, Package } from "lucide-react";
import type { PublicRelease } from "@shared/schema";

export default function Downloads() {
  const { user, isLoading, logoutMutation } = useAuth();
  const [, navigate] = useLocation();

  const { data: releases } = useQuery<PublicRelease[]>({
    queryKey: ["/api/releases"],
  });

  if (isLoading) return null;
  if (!user) {
    navigate("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-primary" />
            <span className="font-mono font-bold tracking-tighter">
              NEXUS//DISTRIBUTION
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-muted-foreground">
              {user.username}
            </span>
            {user.role === "admin" && (
              <Link href="/admin">
                <Button variant="outline" size="sm" className="font-mono text-xs">
                  ADMIN
                </Button>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logoutMutation.mutate()}
              className="font-mono text-xs"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">
            Available Releases
          </h1>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            Artifacts are served with SHA-256 integrity headers. Downloads are
            recorded.
          </p>
        </div>

        <div className="grid gap-4">
          {(releases ?? []).map((r) => (
            <Card key={r.id} className="border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-primary" />
                  <div>
                    <CardTitle className="font-mono text-base">
                      v{r.version}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {r.artifactName} · {(r.sizeBytes / 1024).toFixed(1)} KiB
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs uppercase">
                    {r.channel}
                  </Badge>
                  <a href={`/api/releases/${r.id}/download`}>
                    <Button size="sm" className="font-mono text-xs uppercase">
                      <Download className="w-4 h-4 mr-1" /> Download
                    </Button>
                  </a>
                </div>
              </CardHeader>
              {r.notes && (
                <CardContent>
                  <p className="text-sm font-mono text-muted-foreground whitespace-pre-wrap">
                    {r.notes}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2 break-all">
                    SHA256 {r.sha256}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
          {(releases ?? []).length === 0 && (
            <p className="font-mono text-sm text-muted-foreground">
              No published releases yet.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

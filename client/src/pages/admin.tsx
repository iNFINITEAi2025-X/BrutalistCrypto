import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Download as DownloadIcon,
  FileWarning,
  KeyRound,
  LogOut,
  Package,
  Play,
  ScrollText,
  Users,
  XCircle,
} from "lucide-react";
import type {
  AuditChecklistItem,
  AuditLogEntry,
  DailyAudit,
  Download,
  LedgerEntry,
  License,
  PublicRelease,
  PublicUser,
} from "@shared/schema";

export default function Admin() {
  const { user, isLoading, logoutMutation } = useAuth();
  const [, navigate] = useLocation();

  if (isLoading) return null;
  if (!user) {
    navigate("/login");
    return null;
  }
  if (user.role !== "admin") {
    navigate("/download");
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-primary animate-pulse" />
            <span className="font-mono font-bold tracking-tighter">
              NEXUS//ADMIN
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-muted-foreground">
              {user.username}
            </span>
            <Link href="/trades">
              <Button variant="outline" size="sm" className="font-mono text-xs">
                TRADES
              </Button>
            </Link>
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

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="audits">
          <TabsList className="font-mono text-xs uppercase">
            <TabsTrigger value="audits">
              <ClipboardCheck className="w-3 h-3 mr-1" /> Daily Audits
            </TabsTrigger>
            <TabsTrigger value="releases">
              <Package className="w-3 h-3 mr-1" /> Releases
            </TabsTrigger>
            <TabsTrigger value="licenses">
              <KeyRound className="w-3 h-3 mr-1" /> Licenses
            </TabsTrigger>
            <TabsTrigger value="downloads">
              <DownloadIcon className="w-3 h-3 mr-1" /> Downloads
            </TabsTrigger>
            <TabsTrigger value="ledger">
              <BookOpenCheck className="w-3 h-3 mr-1" /> Ledger
            </TabsTrigger>
            <TabsTrigger value="auditlog">
              <ScrollText className="w-3 h-3 mr-1" /> Audit Log
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="w-3 h-3 mr-1" /> Users
            </TabsTrigger>
          </TabsList>

          <TabsContent value="audits">
            <DailyAuditsTab />
          </TabsContent>
          <TabsContent value="releases">
            <ReleasesTab />
          </TabsContent>
          <TabsContent value="licenses">
            <LicensesTab />
          </TabsContent>
          <TabsContent value="downloads">
            <DownloadsTab />
          </TabsContent>
          <TabsContent value="ledger">
            <LedgerTab />
          </TabsContent>
          <TabsContent value="auditlog">
            <AuditLogTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily audits — the admin approval checklist
// ---------------------------------------------------------------------------

function DailyAuditsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<DailyAudit | null>(null);
  const [note, setNote] = useState("");

  const { data: audits } = useQuery<DailyAudit[]>({
    queryKey: ["/api/admin/audits/daily"],
  });

  const runAudit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audits/run");
      return res.json();
    },
    onSuccess: (d) => {
      toast({ title: `System audit complete — ${d.count} finding(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audits/daily"] });
    },
  });

  const generateToday = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audits/daily/generate", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audits/daily"] });
    },
  });

  const review = useMutation({
    mutationFn: async (input: { id: string; decision: "approved" | "rejected" }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/audits/daily/${input.id}/review`,
        { decision: input.decision, note },
      );
      return res.json();
    },
    onSuccess: () => {
      setSelected(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audits/daily"] });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="font-mono text-lg uppercase">
              Daily Audit Packages
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              Generated by the AI bookkeeper; awaiting admin sign-off.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs"
              onClick={() => runAudit.mutate()}
              disabled={runAudit.isPending}
            >
              <Play className="w-3 h-3 mr-1" /> Run Scan
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => generateToday.mutate()}
              disabled={generateToday.isPending}
            >
              Generate Today
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Date</TableHead>
                <TableHead className="font-mono text-xs">Status</TableHead>
                <TableHead className="font-mono text-xs">Anomalies</TableHead>
                <TableHead className="font-mono text-xs">Reviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audits ?? []).map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(a)}
                >
                  <TableCell className="font-mono text-xs">{a.date}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        a.status === "approved"
                          ? "default"
                          : a.status === "rejected"
                            ? "destructive"
                            : "outline"
                      }
                      className="font-mono text-[10px] uppercase"
                    >
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.anomalyCount}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.reviewedBy ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(audits ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    No daily audits yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono text-lg uppercase">
            Checklist Review
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            {selected
              ? `Audit for ${selected.date} — anomaly count ${selected.anomalyCount}`
              : "Select an audit to review its checklist."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected && (
            <>
              <div className="space-y-2">
                {(selected.checklist as AuditChecklistItem[]).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start gap-2 border border-border p-2"
                  >
                    {item.status === "passed" ? (
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5" />
                    ) : item.status === "failed" ? (
                      <XCircle className="w-4 h-4 text-destructive mt-0.5" />
                    ) : (
                      <FileWarning className="w-4 h-4 text-muted-foreground mt-0.5" />
                    )}
                    <div>
                      <p className="font-mono text-xs">{item.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                {Object.entries(
                  selected.totals as Record<string, number>,
                ).map(([k, v]) => (
                  <div key={k} className="border border-border p-2">
                    <span className="text-muted-foreground">{k}</span>
                    <div className="text-sm">{v}</div>
                  </div>
                ))}
              </div>

              {selected.status === "pending" ? (
                <>
                  <div className="space-y-2">
                    <Label className="font-mono text-xs uppercase">
                      Review note
                    </Label>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="font-mono text-xs"
                      placeholder="Optional note for the audit trail…"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="font-mono text-xs uppercase flex-1"
                      onClick={() =>
                        review.mutate({ id: selected.id, decision: "approved" })
                      }
                      disabled={review.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      className="font-mono text-xs uppercase flex-1"
                      onClick={() =>
                        review.mutate({ id: selected.id, decision: "rejected" })
                      }
                      disabled={review.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              ) : (
                <p className="font-mono text-xs text-muted-foreground">
                  {selected.status.toUpperCase()} by {selected.reviewedBy}
                  {selected.reviewNote ? ` — “${selected.reviewNote}”` : ""}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

function ReleasesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const { data: releases } = useQuery<PublicRelease[]>({
    queryKey: ["/api/admin/releases"],
  });

  const createRelease = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose an artifact file");
      const artifactData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = () => {
          const result = String(reader.result);
          resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
      });
      const res = await apiRequest("POST", "/api/admin/releases", {
        version,
        channel,
        notes,
        artifactName: file.name,
        artifactData,
        published: true,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Release published" });
      setVersion("");
      setNotes("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/releases"] });
    },
    onError: (err) => {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const togglePublished = useMutation({
    mutationFn: async (r: PublicRelease) => {
      const res = await apiRequest("PATCH", `/api/admin/releases/${r.id}`, {
        published: !r.published,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/releases"] });
    },
  });

  const deleteRelease = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/releases/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono text-lg uppercase">
            Publish Release
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">Version</Label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">stable</SelectItem>
                <SelectItem value="beta">beta</SelectItem>
                <SelectItem value="nightly">nightly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">Artifact</Label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="font-mono text-xs"
            />
          </div>
          <Button
            className="w-full font-mono text-xs uppercase"
            disabled={!version || !file || createRelease.isPending}
            onClick={() => createRelease.mutate()}
          >
            {createRelease.isPending ? "Publishing…" : "Publish"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-mono text-lg uppercase">
            All Releases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Version</TableHead>
                <TableHead className="font-mono text-xs">Channel</TableHead>
                <TableHead className="font-mono text-xs">Artifact</TableHead>
                <TableHead className="font-mono text-xs">Size</TableHead>
                <TableHead className="font-mono text-xs">Published</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(releases ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.version}</TableCell>
                  <TableCell className="font-mono text-xs">{r.channel}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.artifactName}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {(r.sizeBytes / 1024).toFixed(1)} KiB
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={r.published ? "default" : "outline"}
                      className="font-mono text-[10px] uppercase"
                      onClick={() => togglePublished.mutate(r)}
                    >
                      {r.published ? "live" : "hidden"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="font-mono text-[10px] uppercase text-destructive"
                      onClick={() => deleteRelease.mutate(r.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

function LicensesTab() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("0");

  const { data: licenses } = useQuery<License[]>({
    queryKey: ["/api/admin/licenses"],
  });

  const createLicense = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/licenses", {
        label,
        maxDownloads: parseInt(maxDownloads, 10) || 0,
      });
      return res.json();
    },
    onSuccess: () => {
      setLabel("");
      setMaxDownloads("0");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: "active" | "revoked" }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/licenses/${input.id}`,
        { status: input.status },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono text-lg uppercase">New License</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="font-mono"
              placeholder="Customer / purpose"
            />
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase">
              Max downloads (0 = unlimited)
            </Label>
            <Input
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value)}
              type="number"
              min={0}
              className="font-mono"
            />
          </div>
          <Button
            className="w-full font-mono text-xs uppercase"
            onClick={() => createLicense.mutate()}
            disabled={createLicense.isPending}
          >
            Generate Key
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-mono text-lg uppercase">Licenses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Key</TableHead>
                <TableHead className="font-mono text-xs">Label</TableHead>
                <TableHead className="font-mono text-xs">Status</TableHead>
                <TableHead className="font-mono text-xs">Usage</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(licenses ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-[10px] break-all max-w-[220px]">
                    {l.key}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.label}</TableCell>
                  <TableCell>
                    <Badge
                      variant={l.status === "active" ? "default" : "destructive"}
                      className="font-mono text-[10px] uppercase"
                    >
                      {l.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.downloadsUsed}
                    {l.maxDownloads > 0 ? ` / ${l.maxDownloads}` : " / ∞"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-[10px] uppercase"
                      onClick={() =>
                        setStatus.mutate({
                          id: l.id,
                          status: l.status === "active" ? "revoked" : "active",
                        })
                      }
                    >
                      {l.status === "active" ? "Revoke" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function DownloadsTab() {
  const { data: downloads } = useQuery<Download[]>({
    queryKey: ["/api/admin/downloads"],
  });
  const { data: releases } = useQuery<PublicRelease[]>({
    queryKey: ["/api/admin/releases"],
  });

  const releaseById = new Map((releases ?? []).map((r) => [r.id, r]));

  return (
    <Card className="border-border mt-4">
      <CardHeader>
        <CardTitle className="font-mono text-lg uppercase">
          Download Records
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          Every artifact download is recorded with user, license, IP and user
          agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">When</TableHead>
              <TableHead className="font-mono text-xs">Release</TableHead>
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">License</TableHead>
              <TableHead className="font-mono text-xs">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(downloads ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">
                  {new Date(d.downloadedAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {releaseById.get(d.releaseId)?.version ?? d.releaseId}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {d.userId ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {d.licenseId ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{d.ip || "—"}</TableCell>
              </TableRow>
            ))}
            {(downloads ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="font-mono text-xs text-muted-foreground"
                >
                  No downloads recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function LedgerTab() {
  const { data: entries } = useQuery<LedgerEntry[]>({
    queryKey: ["/api/admin/ledger"],
  });
  const balance = (entries ?? []).reduce((a, e) => a + e.amountUsd, 0);

  return (
    <Card className="border-border mt-4">
      <CardHeader>
        <CardTitle className="font-mono text-lg uppercase">
          AI Bookkeeper Ledger
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          Balance: ${balance.toFixed(2)} USD
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">When</TableHead>
              <TableHead className="font-mono text-xs">Category</TableHead>
              <TableHead className="font-mono text-xs">Description</TableHead>
              <TableHead className="font-mono text-xs text-right">
                Amount USD
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entries ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">
                  {new Date(e.ts).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs uppercase">
                  {e.category}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.description}
                </TableCell>
                <TableCell className="font-mono text-xs text-right">
                  {e.amountUsd.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
            {(entries ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="font-mono text-xs text-muted-foreground"
                >
                  No ledger entries yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function AuditLogTab() {
  const { data: entries } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/admin/audit-log"],
  });

  return (
    <Card className="border-border mt-4">
      <CardHeader>
        <CardTitle className="font-mono text-lg uppercase">
          Immutable Audit Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">When</TableHead>
              <TableHead className="font-mono text-xs">Actor</TableHead>
              <TableHead className="font-mono text-xs">Action</TableHead>
              <TableHead className="font-mono text-xs">Severity</TableHead>
              <TableHead className="font-mono text-xs">Entity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entries ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">
                  {new Date(e.ts).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.actor}</TableCell>
                <TableCell className="font-mono text-xs">{e.action}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      e.severity === "critical"
                        ? "destructive"
                        : e.severity === "warning"
                          ? "outline"
                          : "default"
                    }
                    className="font-mono text-[10px] uppercase"
                  >
                    {e.severity}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.entity}
                  {e.entityId ? `:${e.entityId.slice(0, 8)}` : ""}
                </TableCell>
              </TableRow>
            ))}
            {(entries ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="font-mono text-xs text-muted-foreground"
                >
                  Audit log is empty.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function UsersTab() {
  const queryClient = useQueryClient();
  const { data: users } = useQuery<PublicUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const setRole = useMutation({
    mutationFn: async (input: { id: string; role: "admin" | "user" }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${input.id}`, {
        role: input.role,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  return (
    <Card className="border-border mt-4">
      <CardHeader>
        <CardTitle className="font-mono text-lg uppercase">Users</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">Username</TableHead>
              <TableHead className="font-mono text-xs">Role</TableHead>
              <TableHead className="font-mono text-xs">Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">{u.username}</TableCell>
                <TableCell>
                  <Badge
                    variant={u.role === "admin" ? "default" : "outline"}
                    className="font-mono text-[10px] uppercase"
                  >
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-mono text-[10px] uppercase"
                    onClick={() =>
                      setRole.mutate({
                        id: u.id,
                        role: u.role === "admin" ? "user" : "admin",
                      })
                    }
                  >
                    Make {u.role === "admin" ? "user" : "admin"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

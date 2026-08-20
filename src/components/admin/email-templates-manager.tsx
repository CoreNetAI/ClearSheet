"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  EMAIL_TEMPLATE_LIST,
  findUnknownVariables,
  renderEmail,
  sampleVariables,
  type EmailContent,
  type EmailTemplateDefinition,
  type EmailTemplateKey,
} from "@/lib/email-templates";
import { formatDateTime } from "@/lib/format";
import {
  resetEmailTemplate,
  saveEmailTemplate,
} from "@/app/(app)/admin/actions";

export interface SavedEmailTemplate {
  key: EmailTemplateKey;
  subject: string;
  heading: string;
  body: string;
  button_label: string;
  footer: string;
  updated_at: string;
  editor: { full_name: string | null } | null;
}

function toContent(saved: SavedEmailTemplate): EmailContent {
  return {
    subject: saved.subject,
    heading: saved.heading,
    body: saved.body,
    buttonLabel: saved.button_label,
    footer: saved.footer,
  };
}

export function EmailTemplatesManager({
  saved,
}: {
  saved: SavedEmailTemplate[];
}) {
  const savedByKey = useMemo(
    () => new Map(saved.map((s) => [s.key, s])),
    [saved]
  );
  const [editingKey, setEditingKey] = useState<EmailTemplateKey | null>(null);
  const editing = EMAIL_TEMPLATE_LIST.find((t) => t.key === editingKey);
  const editingSaved = editingKey ? savedByKey.get(editingKey) : undefined;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Emails you can customize</CardTitle>
          <CardDescription>
            {EMAIL_TEMPLATE_LIST.length} emails. Changes apply to the next email
            sent; emails already sent don&apos;t change.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Sent to</TableHead>
                  <TableHead>Sent when</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EMAIL_TEMPLATE_LIST.map((template) => {
                  const custom = savedByKey.get(template.key);
                  return (
                    <TableRow key={template.key}>
                      <TableCell className="font-medium">
                        {template.name}
                      </TableCell>
                      <TableCell>{template.sentTo}</TableCell>
                      <TableCell>{template.sentWhen}</TableCell>
                      <TableCell>
                        {custom ? (
                          <div className="grid justify-items-start gap-1">
                            <Badge>Customized</Badge>
                            <span className="text-xs text-muted-foreground">
                              {custom.editor?.full_name ?? "Unknown"},{" "}
                              {formatDateTime(custom.updated_at)}
                            </span>
                          </div>
                        ) : (
                          <Badge variant="secondary">Default</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`View or edit ${template.name}`}
                          onClick={() => setEditingKey(template.key)}
                        >
                          <Pencil className="h-4 w-4" />
                          View / edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emails managed elsewhere</CardTitle>
          <CardDescription>
            These 2 emails are sent by Supabase, so this screen can&apos;t change
            them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <span className="font-medium">Forgot password</span> and{" "}
            <span className="font-medium">Confirm signup</span>: edit these in
            Supabase under Authentication → Emails.
          </p>
        </CardContent>
      </Card>

      {editing && (
        <TemplateEditor
          // Remount per template and saved version so the form starts fresh.
          key={`${editing.key}:${editingSaved?.updated_at ?? "default"}`}
          template={editing}
          saved={editingSaved}
          onClose={() => setEditingKey(null)}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  saved,
  onClose,
}: {
  template: EmailTemplateDefinition;
  saved?: SavedEmailTemplate;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [content, setContent] = useState<EmailContent>(
    saved ? toContent(saved) : template.defaults
  );
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const unknown = useMemo(
    () => findUnknownVariables(template, content),
    [template, content]
  );
  const preview = useMemo(
    () =>
      renderEmail(content, sampleVariables(template), template.sampleBlocks),
    [template, content]
  );

  function update(field: keyof EmailContent, value: string) {
    setContent((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setBusy("save");
    const res = await saveEmailTemplate({ key: template.key, ...content });
    setBusy(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    toast({ title: "Template saved", description: template.name });
    onClose();
    router.refresh();
  }

  async function reset() {
    if (!window.confirm(`Reset "${template.name}" to the default text?`)) return;
    setBusy("reset");
    const res = await resetEmailTemplate(template.key);
    setBusy(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    toast({ title: "Reset to default", description: template.name });
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>
            Sent to: {template.sentTo}. Sent when: {template.sentWhen}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <Label htmlFor="template-subject">Subject</Label>
              <Input
                id="template-subject"
                value={content.subject}
                maxLength={200}
                onChange={(e) => update("subject", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-heading">Heading</Label>
              <Input
                id="template-heading"
                value={content.heading}
                maxLength={200}
                onChange={(e) => update("heading", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-body">Message</Label>
              <Textarea
                id="template-body"
                value={content.body}
                maxLength={5000}
                rows={6}
                onChange={(e) => update("body", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Plain text. Leave a blank line to start a new paragraph.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-button">Button text</Label>
              <Input
                id="template-button"
                value={content.buttonLabel}
                maxLength={60}
                onChange={(e) => update("buttonLabel", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-footer">Footer (optional)</Label>
              <Textarea
                id="template-footer"
                value={content.footer}
                maxLength={2000}
                rows={3}
                onChange={(e) => update("footer", e.target.value)}
              />
            </div>

            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <p className="font-medium">Variables you can use</p>
              {template.variables.map((v) => (
                <p key={v.name}>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {`{{${v.name}}}`}
                  </code>{" "}
                  <span className="text-muted-foreground">{v.description}</span>
                </p>
              ))}
              <p className="mt-2 text-xs text-muted-foreground">
                Always included, not editable: {template.fixedContent}
              </p>
            </div>

            {unknown.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Unknown variable: {unknown.map((v) => `{{${v}}}`).join(", ")}
              </p>
            )}
          </div>

          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Preview with sample data</p>
            <p className="rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Subject:</span>{" "}
              <span data-testid="preview-subject">{preview.subject}</span>
            </p>
            {/* An empty sandbox stops anything in the preview from running. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[480px] w-full rounded-md border bg-white"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={reset}
            disabled={!saved || busy !== null}
          >
            {busy === "reset" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Reset to default
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={busy !== null || unknown.length > 0}
            >
              {busy === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

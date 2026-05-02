"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { ExternalLink, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format";
import type { AttachmentType } from "@/lib/types";

export interface AttachmentItem {
  id: string;
  file_name: string | null;
  attachment_type: AttachmentType;
  uploaded_at: string;
}

export function AttachmentsManager({
  timesheetId,
  attachments,
  editable,
  onAdd,
  onRemove,
}: {
  timesheetId: string;
  attachments: AttachmentItem[];
  editable: boolean;
  onAdd: (a: AttachmentItem) => void;
  onRemove: (id: string) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const type: AttachmentType = "approved_timesheet";
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (file) void uploadFile(file);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timesheetId,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          attachmentType: type,
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Upload failed");

      const put = await fetch(presign.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload to storage failed");

      const confirmRes = await fetch("/api/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timesheetId,
          key: presign.key,
          fileName: file.name,
          attachmentType: type,
        }),
      });
      const confirm = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirm.error || "Could not save");

      onAdd(confirm.attachment as AttachmentItem);
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "File uploaded" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not delete");
      }
      onRemove(id);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No files uploaded yet.
        </p>
      ) : (
        <ul className="grid gap-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {a.file_name || "file"}
                </span>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(a.uploaded_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" asChild>
                  <a
                    href={`/api/attachments/${a.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Preview file"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(a.id)}
                    disabled={removingId === a.id}
                    aria-label="Delete file"
                  >
                    {removingId === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="grid gap-2 rounded-md border border-dashed p-4">
          <input
            ref={fileRef}
            id="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            variant="secondary"
            className="w-full"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading ? "Uploading…" : "Choose file to upload"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Client-approved timesheet · PDF, PNG, JPG, XLSX · ≤10 MB
          </p>
        </div>
      )}
    </div>
  );
}

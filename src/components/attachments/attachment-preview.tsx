import { ExternalLink } from "lucide-react";

import { extOf } from "@/lib/r2";
import { Button } from "@/components/ui/button";

// Renders an inline preview of an attachment using the auth-gated download
// route (the browser sends session cookies, which 302s to a presigned R2 URL).
export function AttachmentPreview({
  attachment,
}: {
  attachment: { id: string; file_name: string | null; attachment_type: string };
}) {
  const ext = extOf(attachment.file_name || "");
  const src = `/api/attachments/${attachment.id}/download`;
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  const isPdf = ext === "pdf";

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {attachment.file_name || "file"}
        </span>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <a href={src} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={attachment.file_name || "attachment"}
            className="max-h-[480px] w-full object-contain"
          />
        ) : isPdf ? (
          <iframe
            src={src}
            title={attachment.file_name || "attachment"}
            className="h-[480px] w-full"
          />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Preview not available for this file type. Use “Open” to download.
          </div>
        )}
      </div>
    </div>
  );
}

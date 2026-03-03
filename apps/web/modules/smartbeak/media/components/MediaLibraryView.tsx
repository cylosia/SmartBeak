"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/toast";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  ImageIcon,
  UploadIcon,
  MoreHorizontalIcon,
  TrashIcon,
  CopyIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function MediaLibraryView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const mediaQuery = useQuery(
    orpc.smartbeak.media.list.queryOptions({
      input: { organizationSlug, domainId, limit: 50, offset: 0 },
    }),
  );

  const uploadUrlMutation = useMutation(
    orpc.smartbeak.media.createUploadUrl.mutationOptions(),
  );

  const deleteMutation = useMutation(
    orpc.smartbeak.media.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.media.list.key(),
        });
        toast({ title: "Media deleted" });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "error" });
      },
    }),
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { signedUploadUrl } = await uploadUrlMutation.mutateAsync({
        organizationSlug,
        domainId,
        fileName: file.name,
        type: file.type,
        size: file.size,
      });
      await fetch(signedUploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      queryClient.invalidateQueries({
        queryKey: orpc.smartbeak.media.list.key(),
      });
      toast({ title: "Upload complete", description: file.name });
    } catch {
      toast({ title: "Upload failed", variant: "error" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "URL copied to clipboard" });
  };

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {mediaQuery.data?.items.length ?? 0} assets
          </p>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
              onChange={handleFileChange}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <UploadIcon className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>

        {/* Grid */}
        {mediaQuery.isLoading ? (
          <CardGridSkeleton count={8} cols={5} />
        ) : mediaQuery.data?.items.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="No media yet"
            description="Upload images, videos, and documents for this domain."
            action={
              <Button onClick={() => fileInputRef.current?.click()}>
                <UploadIcon className="mr-2 h-4 w-4" />
                Upload
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {mediaQuery.data?.items.map((asset) => (
              <div
                key={asset.id}
                className="group relative rounded-xl border border-border overflow-hidden bg-muted/30 hover:border-primary/50 transition-colors"
              >
                <div className="aspect-square flex items-center justify-center bg-muted">
                  {asset.type?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt={asset.fileName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{asset.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset.createdAt
                      ? formatDistanceToNow(new Date(asset.createdAt), {
                          addSuffix: true,
                        })
                      : "—"}
                  </p>
                </div>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="icon" className="h-7 w-7">
                        <MoreHorizontalIcon className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => copyUrl(asset.url)}>
                        <CopyIcon className="mr-2 h-4 w-4" />
                        Copy URL
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() =>
                          deleteMutation.mutate({
                            organizationSlug,
                            id: asset.id,
                          })
                        }
                      >
                        <TrashIcon className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

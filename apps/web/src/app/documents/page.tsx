'use client';
import { DocumentTable } from '@/components/document-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui';
import { UploadDialog } from '@/components/upload-dialog';
import { Plus } from 'lucide-react';
import { useState } from 'react';
export default function DocumentsPage() {
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return (
    <>
      <PageHeader
        eyebrow="Index"
        title="Documents"
        description="Manage source documents and inspect the state of their active versions."
        action={
          <Button
            onClick={() => setOpen(true)}
            className="bg-accent text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Upload document
          </Button>
        }
      />
      <DocumentTable refresh={refresh} />
      <UploadDialog
        open={open}
        onClose={() => setOpen(false)}
        onComplete={() => setRefresh((x) => x + 1)}
      />
    </>
  );
}

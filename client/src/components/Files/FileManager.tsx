import { AssignModal } from './FileManagerAssignModal';
import { FilesView } from './FileManagerFilesView';
import { ImageLightbox } from './FileManagerImageLightbox';
import { PdfPreviewModal } from './FileManagerPdfPreviewModal';
import { FileManagerToolbar } from './FileManagerToolbar';
import { TrashView } from './FileManagerTrashView';
import { useFileManager, type FileManagerProps } from './useFileManager';

export default function FileManager(props: FileManagerProps) {
  const S = useFileManager(props);
  const { lightboxIndex, setLightboxIndex, imageFiles, assignFileId, previewFile, handlePaste, showTrash } = S;
  return (
    <div
      className="flex h-full flex-col"
      style={{ fontFamily: 'var(--font-system)' }}
      onPaste={handlePaste}
      tabIndex={-1}
    >
      {/* Lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox files={imageFiles} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}

      {/* Assign modal */}
      {assignFileId && <AssignModal {...S} />}

      {/* PDF preview modal */}
      {previewFile && <PdfPreviewModal {...S} />}

      {/* Toolbar */}
      <FileManagerToolbar {...S} />

      {showTrash ? <TrashView {...S} /> : <FilesView {...S} />}

      <style>{`
        @media (max-width: 767px) {
          .file-actions button { padding: 8px !important; }
          .file-actions svg { width: 18px !important; height: 18px !important; }
        }
      `}</style>
    </div>
  );
}

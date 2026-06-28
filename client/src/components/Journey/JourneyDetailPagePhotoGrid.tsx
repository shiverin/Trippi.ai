import { Image } from 'lucide-react';
import { photoUrl } from '../../pages/journeyDetail/JourneyDetailPage.helpers';
import type { JourneyPhoto } from '../../store/journeyStore';

export function PhotoImg({
  photo,
  className,
  style,
  onClick,
}: {
  photo: JourneyPhoto;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const src = photoUrl(photo, 'thumbnail');
  return <img src={src} alt="" className={className} style={style} onClick={onClick} loading="lazy" />;
}

export function PhotoGrid({ photos, onClick }: { photos: JourneyPhoto[]; onClick: (idx: number) => void }) {
  const count = photos.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <div className="cursor-pointer overflow-hidden" onClick={() => onClick(0)}>
        <PhotoImg photo={photos[0]} className="h-72 w-full object-cover" />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5 overflow-hidden">
        {photos.slice(0, 2).map((p, i) => (
          <PhotoImg
            key={p.id}
            photo={p}
            className="h-52 w-full cursor-pointer object-cover"
            onClick={() => onClick(i)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ height: 300, gap: 2 }}>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onClick(0)}>
        <PhotoImg photo={photos[0]} className="h-full w-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
        <div className="min-h-0 flex-1 cursor-pointer" onClick={() => onClick(1)}>
          <PhotoImg photo={photos[1]} className="h-full w-full object-cover" />
        </div>
        <div className="relative min-h-0 flex-1 cursor-pointer" onClick={() => onClick(2)}>
          <PhotoImg photo={photos[2]} className="h-full w-full object-cover" />
          {count > 3 && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              <Image size={10} />+{count - 3}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

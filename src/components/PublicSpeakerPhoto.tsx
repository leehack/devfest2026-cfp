import { useEffect, useRef, useState } from 'react';

import { publicSchedulePhoto } from '../lib/schedule';

function imageBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/webp' });
}

export function PublicSpeakerPhoto({
  cfpId,
  releaseId,
  entryId,
  speakerIndex,
  name,
  photoRef,
  enabled,
  compact = false,
}: {
  cfpId: string;
  releaseId: string;
  entryId: string;
  speakerIndex: number;
  name: string;
  photoRef?: string;
  enabled: boolean;
  compact?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const imageUrl = useRef('');
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = '';
    setSrc('');
    setVisible(false);
  }, [enabled, entryId, photoRef, releaseId, speakerIndex]);

  useEffect(() => {
    if (!enabled || !photoRef) return;
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, photoRef]);

  useEffect(() => {
    if (!visible || !enabled || !photoRef) return;
    let cancelled = false;
    void publicSchedulePhoto({ cfpId, releaseId, entryId, speakerIndex })
      .then(({ data }) => {
        if (cancelled) return;
        if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
        imageUrl.current = URL.createObjectURL(imageBlob(data.base64));
        setSrc(imageUrl.current);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, enabled, entryId, photoRef, releaseId, speakerIndex, visible]);

  useEffect(
    () => () => {
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    },
    [],
  );

  return (
    <span
      ref={root}
      className={`public-speaker-photo${compact ? ' public-speaker-photo--compact' : ''}`}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : name.trim().slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

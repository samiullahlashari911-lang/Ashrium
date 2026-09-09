/**
 * Pause WebGL / MediaPipe while a canvas is off-screen or the tab is hidden.
 * Same-tab scroll does not stop requestAnimationFrame; IntersectionObserver does.
 */

export function isViewportRenderActive(input: {
  documentHidden: boolean;
  isIntersecting: boolean;
}): boolean {
  return !input.documentHidden && input.isIntersecting;
}

export function subscribeViewportActivity(
  element: Element,
  onChange: (active: boolean) => void,
): () => void {
  let isIntersecting = false;
  let documentHidden = document.visibilityState === 'hidden';

  const emit = (): void => {
    onChange(isViewportRenderActive({ documentHidden, isIntersecting }));
  };

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      isIntersecting = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
      emit();
    });
    observer.observe(element);
  }

  const onVisibility = (): void => {
    documentHidden = document.visibilityState === 'hidden';
    emit();
  };

  document.addEventListener('visibilitychange', onVisibility);
  emit();

  return () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

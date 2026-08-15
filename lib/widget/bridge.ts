export interface VfrSetGarmentEvent {
  sku: string;
  variantId?: string;
}

export interface VfrSetUserParamsEvent {
  chestCm?: number;
  heightCm?: number;
  waistCm?: number;
}

export interface VfrSizeRecommendedEvent {
  size: string;
}

export interface VfrWidgetReadyEvent {
  sku: string;
}

export interface VfrResizeViewportEvent {
  height: number;
}

export type HostToWidgetEvent =
  | { payload: VfrSetGarmentEvent; type: 'VFR_SET_GARMENT' }
  | { payload: VfrSetUserParamsEvent; type: 'VFR_SET_USER_PARAMS' };

export type WidgetToHostEvent =
  | { payload: VfrSizeRecommendedEvent; type: 'VFR_SIZE_RECOMMENDED' }
  | { payload: VfrWidgetReadyEvent; type: 'VFR_WIDGET_READY' }
  | { payload: VfrResizeViewportEvent; type: 'VFR_RESIZE_VIEWPORT' };

const MESSAGE_SOURCE = 'ashrium-vfr';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

function isPermittedOrigin(origin: string, targetOrigin: string): boolean {
  return isLocalDevelopment() || origin === targetOrigin;
}

function isHostToWidgetEvent(value: unknown): value is HostToWidgetEvent {
  if (!isRecord(value) || value.source !== MESSAGE_SOURCE || !isRecord(value.payload)) {
    return false;
  }

  if (value.type === 'VFR_SET_GARMENT') {
    return isNonEmptyString(value.payload.sku)
      && (value.payload.variantId === undefined || isNonEmptyString(value.payload.variantId));
  }

  if (value.type !== 'VFR_SET_USER_PARAMS') {
    return false;
  }

  const { chestCm, heightCm, waistCm } = value.payload;
  return (
    (chestCm === undefined || isPositiveNumber(chestCm))
    && (heightCm === undefined || isPositiveNumber(heightCm))
    && (waistCm === undefined || isPositiveNumber(waistCm))
  );
}

export function postWidgetEvent(event: WidgetToHostEvent, targetOrigin: string): void {
  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }

  window.parent.postMessage(
    { ...event, source: MESSAGE_SOURCE },
    isLocalDevelopment() ? '*' : targetOrigin,
  );
}

export function subscribeToHostEvents(
  targetOrigin: string,
  onEvent: (event: HostToWidgetEvent) => void,
): () => void {
  const listener = (message: MessageEvent<unknown>): void => {
    if (
      message.source !== window.parent
      || !isPermittedOrigin(message.origin, targetOrigin)
      || !isHostToWidgetEvent(message.data)
    ) {
      return;
    }

    onEvent(message.data);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

import {useTVEventHandler as useKeplerTVEventHandler} from '@amazon-devices/react-native-kepler';

export type TVEvent = {eventType: string; eventKeyAction?: number};

/**
 * Vega OS remote-key events: the Kepler platform's own hook.
 *
 * Vega delivers the D-pad, media and back keys through this hook already, so the adapter is
 * a pass-through. The cast only erases the platform's own event type so that shared callers
 * — and the Fire OS adapter beside this file — can agree on one platform-free signature.
 */
export function useTVEventHandler(handler: (event: TVEvent) => void): void {
  useKeplerTVEventHandler(handler as Parameters<typeof useKeplerTVEventHandler>[0]);
}

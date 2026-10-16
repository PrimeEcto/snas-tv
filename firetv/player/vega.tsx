/**
 * Vega player surface: no media element.
 *
 * Vega OS has no ExoPlayer and no libVLC — its media stack is reached through Amazon's own
 * W3C Media API (`@amazon-devices/react-native-w3cmedia`) plus an MSE JavaScript player.
 * That integration is not built yet, so this build keeps the honest simulated preview:
 * the surface renders nothing and `PlayerScreen` falls back to its own timeline.
 */
import type {PlayerSurfaceProps} from '../../src/player';

export const supportsPlayback = false;

export function PlayerSurface(_props: PlayerSurfaceProps) {
  return null;
}

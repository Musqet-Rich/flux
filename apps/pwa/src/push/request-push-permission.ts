// Asks for notification permission while a user gesture is live (the Pair button, before any
// await), so the later silent subscribe after `hello` finds it granted. Fire and forget: the
// result only matters to subscribe-push.ts, which reads `Notification.permission`.

export const requestPushPermission = (): void => {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => 'denied');
};

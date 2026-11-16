/** أنواع الصياغة المشتركة التي يستوردها الخادم (notify-device.ts) لرسم إشعار الجوال. */
export interface NotificationText {
  title: string;
  body: string;
  group: 'messages' | 'favorites' | 'social' | 'system';
  image: string | null;
}
export function notificationData(row: { body?: unknown } | null | undefined): Record<string, unknown> | null;
export function unitLine(data: Record<string, unknown> | null | undefined): string;
export function describeNotification(row: Record<string, unknown> | null | undefined, actor?: string): NotificationText;

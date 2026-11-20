// Type declarations for `uiohook-napi`, used ONLY by tsconfig.ci.json.
//
// uiohook-napi is a native Windows module, so `npm ci --ignore-scripts` on
// Linux CI does not install it (it lives in release/app/package.json).
// These declarations mirror the published typings of uiohook-napi 1.5.x for
// the parts of the API we call. The Windows build never includes this file:
// it is not covered by tsconfig.json's resolution of 'uiohook-napi' and is
// only reachable through the `paths` entry in tsconfig.ci.json.

export declare enum EventType {
  EVENT_KEY_TYPED = 3,
  EVENT_KEY_PRESSED = 4,
  EVENT_KEY_RELEASED = 5,
  EVENT_MOUSE_CLICKED = 6,
  EVENT_MOUSE_PRESSED = 7,
  EVENT_MOUSE_RELEASED = 8,
  EVENT_MOUSE_MOVED = 9,
  EVENT_MOUSE_DRAGGED = 10,
  EVENT_MOUSE_WHEEL = 11,
}

interface UiohookEventBase {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface UiohookKeyboardEvent extends UiohookEventBase {
  type: EventType.EVENT_KEY_PRESSED | EventType.EVENT_KEY_RELEASED;
  keycode: number;
}

export interface UiohookMouseEvent extends UiohookEventBase {
  type:
    | EventType.EVENT_MOUSE_CLICKED
    | EventType.EVENT_MOUSE_PRESSED
    | EventType.EVENT_MOUSE_RELEASED
    | EventType.EVENT_MOUSE_MOVED
    | EventType.EVENT_MOUSE_DRAGGED;
  x: number;
  y: number;
  button: unknown;
  clicks: number;
}

export interface UiohookWheelEvent extends UiohookEventBase {
  type: EventType.EVENT_MOUSE_WHEEL;
  x: number;
  y: number;
  clicks: number;
  amount: number;
  direction: number;
  rotation: number;
}

type KeyboardEventName = 'keydown' | 'keyup';
type MouseEventName = 'mousedown' | 'mouseup' | 'mousemove' | 'click';

interface UiohookListeners {
  (event: KeyboardEventName, listener: (e: UiohookKeyboardEvent) => void): this;
  (event: MouseEventName, listener: (e: UiohookMouseEvent) => void): this;
  (event: 'wheel', listener: (e: UiohookWheelEvent) => void): this;
}

export declare const uIOhook: {
  start(): void;
  stop(): void;
  on: UiohookListeners;
  once: UiohookListeners;
  off: UiohookListeners;
  addListener: UiohookListeners;
  removeListener: UiohookListeners;
  removeAllListeners(event?: string): unknown;
};

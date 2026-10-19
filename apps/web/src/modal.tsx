import { forwardRef, useRef, type DialogHTMLAttributes } from 'react';
import { PageIcon } from './app-chrome';

/** Backdrop and close buttons use the existing Escape/cancel path, including its save/dirty guards. */
export const Modal = forwardRef<HTMLDialogElement, DialogHTMLAttributes<HTMLDialogElement> & { closeButton?: boolean }>(function Modal({ children, closeButton = true, onPointerDown, onClick, ...props }, ref) {
  const backdropPress = useRef(false);
  function outside(element: HTMLDialogElement, x: number, y: number) {
    const box = element.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  }
  function dismiss(element: HTMLDialogElement) {
    const cancel = new Event('cancel', { cancelable: true });
    if (element.dispatchEvent(cancel)) element.close();
  }
  return <dialog {...props} ref={ref} data-standard-close={closeButton || undefined} onCancel={event => { event.stopPropagation(); props.onCancel?.(event); }} onPointerDown={event => {
    backdropPress.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    onPointerDown?.(event);
  }} onClick={event => {
    const backdrop = backdropPress.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    backdropPress.current = false;
    if (backdrop) { event.preventDefault(); event.stopPropagation(); dismiss(event.currentTarget); return; }
    onClick?.(event);
  }}>
    {children}
    {closeButton && <button type="button" className="secondary ke-modal-dismiss" aria-label="Close dialog" onClick={event => dismiss(event.currentTarget.closest('dialog')!)}><PageIcon name="X" /></button>}
  </dialog>;
});

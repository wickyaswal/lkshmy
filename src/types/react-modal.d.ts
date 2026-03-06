declare module "react-modal" {
  import type { Component, ReactNode } from "react";

  export type ModalProps = {
    isOpen: boolean;
    onRequestClose?: () => void;
    className?: string;
    overlayClassName?: string;
    contentLabel?: string;
    children?: ReactNode;
  };

  export default class Modal extends Component<ModalProps> {
    static setAppElement(appElement: string | HTMLElement): void;
  }
}

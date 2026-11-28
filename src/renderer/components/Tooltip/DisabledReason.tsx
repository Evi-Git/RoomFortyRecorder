import { reasonText } from './reason';

/**
 * The hidden text a button points at with aria-describedby (see
 * nameAndReason). Put it next to the button, inside the tooltip's wrapper.
 */
export const DisabledReason = ({
  id,
  name,
  tooltip,
}: {
  id: string;
  name: string;
  tooltip: string;
}) => {
  const text = reasonText(name, tooltip);
  return text ? (
    <span id={id} className="sr-only">
      {text}
    </span>
  ) : null;
};

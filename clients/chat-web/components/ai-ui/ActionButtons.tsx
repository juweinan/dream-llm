'use client';

import type { UIActionButtons, UIAction } from '@/types/ai-ui';

interface Props {
  actions: UIActionButtons;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const styleClass: Record<string, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 border-blue-600',
  danger:
    'bg-red-50 text-red-700 hover:bg-red-100 border-red-200',
  default:
    'bg-white text-gray-700 hover:bg-gray-50 border-gray-300',
};

export default function ActionButtons({ actions, onAction, disabled }: Props) {
  function handleClick(action: string) {
    if (disabled) return;
    onAction({
      componentType: 'action_buttons',
      payload: { type: 'click', action },
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.actions.map((btn) => (
        <button
          key={btn.action}
          onClick={() => handleClick(btn.action)}
          disabled={disabled}
          className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            styleClass[btn.style ?? 'default']
          }`}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

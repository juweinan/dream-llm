'use client';

import type { UIConfirmation, UIAction } from '@/types/ai-ui';

interface Props {
  confirmation: UIConfirmation;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const riskColors: Record<string, string> = {
  low: 'border-green-300 bg-green-50',
  medium: 'border-yellow-300 bg-yellow-50',
  high: 'border-red-300 bg-red-50',
};

const riskBadgeColors: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

const riskLabels: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export default function ConfirmationDialog({
  confirmation,
  onAction,
  disabled,
}: Props) {
  const risk = confirmation.riskLevel ?? 'medium';

  function handleConfirm() {
    if (disabled) return;
    onAction({
      componentType: 'confirmation',
      payload: { type: 'confirm', confirmed: true },
    });
  }

  function handleCancel() {
    if (disabled) return;
    onAction({
      componentType: 'confirmation',
      payload: { type: 'cancel', confirmed: false },
    });
  }

  return (
    <div
      className={`rounded-lg border p-4 shadow-sm ${riskColors[risk] ?? riskColors.medium}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {confirmation.title}
        </h3>
        {confirmation.riskLevel && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeColors[confirmation.riskLevel]}`}
          >
            {riskLabels[confirmation.riskLevel]}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-gray-600">
        {confirmation.summary}
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={disabled}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirmation.confirmLabel ?? '确认'}
        </button>
        <button
          onClick={handleCancel}
          disabled={disabled}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirmation.cancelLabel ?? '取消'}
        </button>
      </div>
    </div>
  );
}

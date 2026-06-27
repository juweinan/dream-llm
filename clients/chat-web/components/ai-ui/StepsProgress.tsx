import type { UISteps } from '@/types/ai-ui';

interface Props {
  steps: UISteps;
}

const statusClass: Record<string, string> = {
  completed:
    'border-blue-600 bg-blue-600 text-white',
  active:
    'border-blue-600 bg-white text-blue-600',
  pending:
    'border-gray-300 bg-white text-gray-400',
};

const labelClass: Record<string, string> = {
  completed: 'text-gray-900 font-medium',
  active: 'text-blue-600 font-semibold',
  pending: 'text-gray-400',
};

export default function StepsProgress({ steps }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <ol className="flex items-start gap-2">
        {steps.steps.map((step, i) => (
          <li key={i} className="flex flex-1 flex-col items-center text-center">
            <div
              className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${statusClass[step.status]}`}
            >
              {step.status === 'completed' ? '✓' : i + 1}
            </div>
            <span className={`text-xs leading-tight ${labelClass[step.status]}`}>
              {step.label}
            </span>
            {step.description && (
              <span className="mt-0.5 hidden text-xs text-gray-400 sm:block">
                {step.description}
              </span>
            )}
          </li>
        ))}
      </ol>
      {/* 连接线 */}
      <div className="relative mt-1.5 flex px-3.5">
        {steps.steps.slice(0, -1).map((_, i) => (
          <div key={i} className="flex-1">
            <div
              className={`h-0.5 rounded ${
                steps.steps[i + 1].status === 'completed'
                  ? 'bg-blue-600'
                  : 'bg-gray-200'
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

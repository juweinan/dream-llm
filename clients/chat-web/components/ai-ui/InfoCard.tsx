import type { UICard } from '@/types/ai-ui';

interface Props {
  card: UICard;
}

export default function InfoCard({ card }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
        {card.badge && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {card.badge}
          </span>
        )}
      </div>
      <dl className="space-y-1.5">
        {card.items.map((item, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <dt className="min-w-20 shrink-0 text-gray-500">{item.label}</dt>
            <dd className="text-gray-900">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

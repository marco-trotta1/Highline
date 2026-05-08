import type { MarketDriverSignal, MarketTone } from '@/lib/types';

type SignalBreakdownTableProps = {
  drivers: MarketDriverSignal[];
};

const TONE_PILL: Record<MarketTone, string> = {
  bull: 'bg-emerald-500/20 text-emerald-400',
  neutral: 'bg-zinc-700/40 text-zinc-300',
  bear: 'bg-red-500/20 text-red-400',
};

const TONE_DOT: Record<MarketTone, string> = {
  bull: 'bg-emerald-400',
  neutral: 'bg-zinc-400',
  bear: 'bg-red-400',
};

const TONE_LABEL: Record<MarketTone, string> = {
  bull: 'Bull',
  neutral: 'Neutral',
  bear: 'Bear',
};

export function SignalBreakdownTable({ drivers }: SignalBreakdownTableProps) {
  return (
    <div className="rounded-xl border border-[#1E2330] bg-[#13161E] p-5">
      <h2 className="mb-4 text-sm font-medium text-zinc-200">Signal Breakdown</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-normal text-zinc-500">
              <th className="pb-3 font-normal">Signal Source</th>
              <th className="pb-3 font-normal">Weight</th>
              <th className="pb-3 font-normal">Tone</th>
              <th className="pb-3 font-normal">Score</th>
              <th className="pb-3 font-normal">Detail</th>
            </tr>
          </thead>
          <tbody>
            {drivers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-zinc-500">
                  No signal data available
                </td>
              </tr>
            ) : (
              drivers.map((driver) => (
                <tr key={driver.key} className="border-t border-[#1E2330]">
                  <td className="py-3 text-zinc-200">{driver.label}</td>
                  <td className="py-3 font-mono text-zinc-300">
                    {Math.round(driver.weight * 100)}%
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TONE_PILL[driver.tone]}`}
                    >
                      {TONE_LABEL[driver.tone]}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-zinc-300">
                    {driver.score.toFixed(2)}
                  </td>
                  <td className="py-3 text-zinc-400">{driver.detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[#1E2330] pt-3 text-xs text-zinc-500">
        <span>
          Showing {drivers.length === 0 ? 0 : 1}–{drivers.length} of {drivers.length}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled
            className="rounded-md border border-[#2A3040] bg-[#1E2330] px-3 py-1 opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            disabled
            className="rounded-md border border-[#2A3040] bg-[#1E2330] px-3 py-1 opacity-50"
          >
            Next
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
        {(['bull', 'neutral', 'bear'] as const).map((tone) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
            {TONE_LABEL[tone]}
          </span>
        ))}
      </div>
    </div>
  );
}

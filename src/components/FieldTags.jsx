// The two small tags under every field in the editor (and on each Field Settings row): where the
// field goes on WordPress, and whether the AI writes it or someone types it in. `target` comes from
// GET /api/field-settings/wordpress ({ kind, wpKeys, missing? } - see wordpressTargetOf); `checkedLive`
// says whether `missing` was checked against the live site.
import { wordpressTagOf } from '../utils/wordpressTag';

const TAG = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap';

const TONES = {
  ok: 'bg-green-soft text-green-success',
  warn: 'bg-orange-soft text-orange',
  muted: 'bg-off text-muted border border-border',
  ai: 'bg-info-soft text-info',
  manual: 'bg-navy-soft text-navy'
};

export function FieldTags({ target, checkedLive, aiGenerated, className = '' }) {
  const wp = wordpressTagOf(target, checkedLive);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {wp && <span className={`${TAG} ${TONES[wp.tone]}`} title={wp.title}>{wp.text}</span>}
      <span className={`${TAG} ${aiGenerated ? TONES.ai : TONES.manual}`} title={aiGenerated ? 'Written by "Generate All AI Fields"' : 'Typed or pasted in by the team'}>
        {aiGenerated ? 'AI-generated' : 'Filled by hand'}
      </span>
    </div>
  );
}

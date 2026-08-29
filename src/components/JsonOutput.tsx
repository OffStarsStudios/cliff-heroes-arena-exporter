import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { tokenizeJson } from '../lib/highlight';

interface JsonOutputProps {
  json: string;
  filename: string;
}

/** Copies text, falling back to a hidden textarea where the clipboard API is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function JsonOutput({ json, filename }: JsonOutputProps) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const tokens = useMemo(() => tokenizeJson(json), [json]);

  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const download = () => {
    const blob = new Blob([`${json}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const lineCount = json.split('\n').length;

  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="card__hint">
          {lineCount.toLocaleString()} lines - saves as <span className="mono">{filename}</span>
        </span>
        <div className="toolbar">
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => setCopied((await copyText(json)) ? 'ok' : 'fail')}
          >
            <Icon name={copied === 'ok' ? 'check' : 'copy'} size={13} />
            {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}
          </button>
          <button type="button" className="btn btn--sm" onClick={download}>
            <Icon name="download" size={13} />
            Download
          </button>
        </div>
      </div>
      <pre className="json-view" tabIndex={0} aria-label="Generated JSON">
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

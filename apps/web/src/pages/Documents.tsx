import { useRef, useState } from 'react';
import { useDebounced, useQuery } from '../lib/hooks';
import { api } from '../lib/api';
import { relativeTime, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Panel, Spinner, useToast } from '../components/ui';

const DOC_TYPES = ['manual', 'receipt', 'warranty', 'invoice', 'quote', 'contract', 'permit',
  'certificate', 'photo', 'plan', 'lab_result', 'other'];

export function Documents() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [docType, setDocType] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { data, loading, reload } = useQuery<any>(
    `/documents?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}${docType ? `&docType=${docType}` : ''}`,
    [search, docType],
  );

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await api.upload('/files', file);
      } catch (err) {
        toast.push({ message: `${file.name}: ${(err as Error).message}`, tone: 'error' });
      }
    }
    toast.push({ message: `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}` });
    reload();
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Documents</h1>
        <button className="btn btn-sm btn-primary" onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={13} /> Upload
        </button>
        <input ref={fileInput} type="file" multiple className="hidden"
               onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
      </header>

      <div className="flex gap-2">
        <input className="input" placeholder="Search by name" value={term} onChange={(e) => setTerm(e.target.value)} />
        <select className="select w-auto" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">All kinds</option>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </div>

      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="file" title="No documents"
                    hint="Manuals, receipts, warranties, permits. Attach them to the thing they belong to."
                    action={<button className="btn btn-primary" onClick={() => fileInput.current?.click()}>Upload one</button>} />
      )}

      {data?.items.length > 0 && (
        <Panel dense>
          <table className="table">
            <thead><tr><th>Name</th><th>Kind</th><th>Attached to</th><th>Added</th></tr></thead>
            <tbody>
              {data.items.map((d: any) => (
                <tr key={d.id}>
                  <td>
                    <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1.5">
                      <Icon name="file" size={13} className="dim" />
                      {d.title}
                    </a>
                  </td>
                  <td><span className="chip">{titleCase(d.docType)}</span></td>
                  <td className="text-xs dim">{d.entityLabel ?? '—'}</td>
                  <td className="text-xs dim whitespace-nowrap">{relativeTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

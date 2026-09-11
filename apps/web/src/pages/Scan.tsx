import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { quantity } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Panel, useToast } from '../components/ui';

/** Camera scanning, where the browser supports it, with typing as the fallback. */
export function Scan() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [mode, setMode] = useState<'add' | 'use'>('add');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const locations = useQuery<any>('/locations?holdsFood=true&limit=100');
  const [locationId, setLocationId] = useState('');

  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const startCamera = async () => {
    if (!supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          if (found.length) {
            const value = found[0].rawValue as string;
            stopCamera();
            if (value.includes('/s/')) {
              const label = value.split('/s/')[1]!;
              const resolved = await api.get(`/labels/resolve/${label}`);
              if (resolved.route) { navigate(resolved.route); return; }
            }
            setCode(value);
            void lookup(value);
            return;
          }
        } catch { /* frame not ready */ }
        requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch (err) {
      toast.push({ message: `Camera unavailable: ${(err as Error).message}`, tone: 'error' });
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const lookup = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^[A-Z0-9]{4,8}$/i.test(trimmed) && !/^\d+$/.test(trimmed)) {
      try {
        const label = await api.get(`/labels/resolve/${trimmed.toUpperCase()}`);
        if (label.route) { navigate(label.route); return; }
      } catch { /* not a label; try a barcode */ }
    }
    const res = await api.get(`/products/by-barcode/${encodeURIComponent(trimmed)}`);
    setResult(res);
  };

  const apply = async () => {
    if (!result?.product) return;
    await api.post('/capture/stock', {
      productId: result.product.id,
      quantity: 1,
      locationId: locationId || undefined,
      consume: mode === 'use',
    });
    toast.push({ message: `${mode === 'use' ? 'Used' : 'Added'} ${result.product.name}` });
    const refreshed = await api.get(`/products/by-barcode/${encodeURIComponent(code)}`);
    setResult(refreshed);
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Scan</h1>

      {supported ? (
        <Panel dense>
          <div className="relative">
            <video ref={videoRef} playsInline muted
                   className={`w-full rounded-xl bg-black ${scanning ? '' : 'hidden'}`} style={{ aspectRatio: '4/3' }} />
            {!scanning && (
              <button className="btn btn-primary w-full m-0 rounded-xl py-8" onClick={startCamera}>
                <Icon name="camera" size={20} /> Start the camera
              </button>
            )}
          </div>
          {scanning && (
            <button className="btn w-full mt-2" onClick={stopCamera}>Stop</button>
          )}
        </Panel>
      ) : (
        <p className="text-sm dim">
          This browser cannot read barcodes from the camera. Type the number below instead.
        </p>
      )}

      <div className="flex gap-2">
        <input className="input" placeholder="Barcode or label code" value={code}
               onChange={(e) => setCode(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') void lookup(code); }} />
        <button className="btn btn-primary" onClick={() => lookup(code)} disabled={!code.trim()}>Look up</button>
      </div>

      {result && (
        result.found ? (
          <Panel title={result.product.name} dense>
            <div className="p-4 space-y-3">
              <p className="text-sm dim">
                {quantity(result.product.onHand, result.product.defaultUnit)} on hand
              </p>
              <Field label="Where">
                <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Default place</option>
                  {locations.data?.items.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <div className="flex gap-2">
                <button className={`btn flex-1 ${mode === 'add' ? 'btn-primary' : ''}`} onClick={() => setMode('add')}>
                  <Icon name="plus" size={13} /> Put away
                </button>
                <button className={`btn flex-1 ${mode === 'use' ? 'btn-primary' : ''}`} onClick={() => setMode('use')}>
                  <Icon name="minus" size={13} /> Use one
                </button>
              </div>
              <button className="btn btn-primary w-full" onClick={apply}>
                {mode === 'add' ? 'Add one' : 'Take one'}
              </button>
            </div>
          </Panel>
        ) : (
          <EmptyState icon="search" title="Not in the catalogue"
                      hint={`Nothing is filed under ${result.barcode}. Add it as a product from the Food page and it will be recognised next time.`} />
        )
      )}
    </div>
  );
}

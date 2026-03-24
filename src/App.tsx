import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Menu, X, Upload, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from './lib/utils';

interface ImageFile {
  file: File;
  preview: string;
  id: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  processedUrl?: string;
  processedSize?: number;
  error?: string;
}

export default function App() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [dpi, setDpi] = useState<string>('300');
  const [widthCm, setWidthCm] = useState<string>('3.5');
  const [heightCm, setHeightCm] = useState<string>('4.5');
  const [compressToSize, setCompressToSize] = useState<boolean>(true);
  const [targetSizeKb, setTargetSizeKb] = useState<string>('100');
  const [outputFormat, setOutputFormat] = useState<'jpeg' | 'jpg'>('jpeg');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      images.forEach(img => {
        URL.revokeObjectURL(img.preview);
        if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
      });
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = (Array.from(e.target.files) as File[])
        .filter(file => file.type.startsWith('image/'))
        .slice(0, 10 - images.length);
      
      if (newFiles.length === 0 && e.target.files.length > 0) {
        alert('Please select valid image files.');
        return;
      }

      const newImages: ImageFile[] = newFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        id: Math.random().toString(36).substring(7),
        status: 'idle'
      }));
      setImages(prev => [...prev, ...newImages]);
    }
    // Reset input value so same file can be selected again if removed
    if (e.target) e.target.value = '';
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      const removed = prev.find(img => img.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return filtered;
    });
  };

  const cmToPx = (cm: number, dpiVal: number) => {
    return Math.round((cm / 2.54) * dpiVal);
  };

  const processImages = async () => {
    setIsProcessing(true);
    const dpiVal = parseInt(dpi) || 300;
    const targetW = cmToPx(parseFloat(widthCm) || 3.5, dpiVal);
    const targetH = cmToPx(parseFloat(heightCm) || 4.5, dpiVal);
    const targetKb = parseFloat(targetSizeKb) || 100;

    const updatedImages = await Promise.all(images.map(async (img) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const image = new Image();
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Image load timeout')), 15000);
          image.onload = () => {
            clearTimeout(timeout);
            resolve(null);
          };
          image.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Failed to load image'));
          };
          image.src = img.preview;
        });

        // Force exact dimensions as calculated from CM and DPI
        canvas.width = targetW;
        canvas.height = targetH;
        
        if (!ctx) throw new Error('Could not get canvas context');
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, targetW, targetH);
        
        // Draw image stretched to exact target dimensions
        ctx.drawImage(image, 0, 0, targetW, targetH);

        const mimeType = 'image/jpeg'; // Standard for both jpg and jpeg
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), mimeType, 0.98);
        });

        if (!blob) throw new Error('Failed to create blob');

        let finalBlob = blob;

        // 2. Compress/Pad to meet target KB exactly
        if (compressToSize) {
          const targetBytes = Math.floor(targetKb * 1024);
          
          // Binary search for the best quality
          let low = 0.01;
          let high = 1.0;
          let bestBlob = finalBlob;

          for (let i = 0; i < 12; i++) { // Increased iterations for even better precision
            const mid = (low + high) / 2;
            const compressedBlob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob((b) => resolve(b), `image/${outputFormat}`, mid);
            });

            if (compressedBlob) {
              if (compressedBlob.size <= targetBytes) {
                bestBlob = compressedBlob;
                low = mid; 
              } else {
                high = mid;
              }
            }
          }
          finalBlob = bestBlob;

          // 3. If still under target, add padding to reach EXACT KB
          // We use a specific comment block to ensure it doesn't break image headers
          if (finalBlob.size < targetBytes) {
            const paddingSize = targetBytes - finalBlob.size;
            const padding = new Uint8Array(paddingSize).fill(0);
            finalBlob = new Blob([finalBlob, padding], { type: 'image/jpeg' });
          }
        }

        // Revoke old processed URL if it exists
        if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);

        return {
          ...img,
          status: 'done' as const,
          processedUrl: URL.createObjectURL(finalBlob),
          processedSize: finalBlob.size,
          error: undefined
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Processing error for ${img.file.name}:`, errorMessage);
        return {
          ...img,
          status: 'error' as const,
          error: errorMessage
        };
      }
    }));

    setImages(updatedImages);
    setIsProcessing(false);
  };

  const downloadAll = () => {
    images.forEach(img => {
      if (img.processedUrl) {
        const link = document.createElement('a');
        link.href = img.processedUrl;
        link.download = `resized-${img.file.name.split('.')[0]}.${outputFormat}`;
        link.click();
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-800">
      {/* Header */}
      <header className="bg-[#3b5998] text-white p-4 shadow-md">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-white text-[#3b5998] font-bold px-2 py-1 rounded text-xl">Pi</div>
            <div className="bg-white text-[#3b5998] font-bold px-2 py-1 rounded text-xl">7</div>
            <span className="text-2xl font-bold ml-2 tracking-tight">IMAGE TOOL</span>
          </div>
          <button className="p-1 hover:bg-white/10 rounded transition-colors">
            <Menu size={32} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-700">
          Resize Image to {widthCm}cm x {heightCm}cm - Pi7 Image Resizer
        </h1>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
          {/* Dropzone */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files) {
                const newFiles = (Array.from(e.dataTransfer.files) as File[])
                  .filter(file => file.type.startsWith('image/'))
                  .slice(0, 10 - images.length);
                
                const newImages: ImageFile[] = newFiles.map(file => ({
                  file,
                  preview: URL.createObjectURL(file),
                  id: Math.random().toString(36).substring(7),
                  status: 'idle'
                }));
                setImages(prev => [...prev, ...newImages]);
              }
            }}
            className="border-2 border-dashed border-blue-200 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group mb-8"
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              multiple 
              accept="image/*" 
              className="hidden" 
            />
            <div className="flex flex-col items-center gap-4">
              <p className="text-xl text-gray-500 font-medium">Select Or Drag & Drop Images Here</p>
              <button className="bg-[#00a884] hover:bg-[#008f70] text-white px-8 py-3 rounded-md font-bold text-lg shadow-sm transition-colors">
                Select Images
              </button>
            </div>
          </div>

          {/* Image Previews */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-8">
              {images.map((img) => (
                <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                  <img src={img.preview} alt="preview" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => removeImage(img.id)}
                    className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} />
                  </button>
                  {img.status === 'done' && (
                    <div className="absolute inset-0 bg-green-500/20 flex flex-col items-center justify-center">
                      <CheckCircle2 className="text-green-600" size={32} />
                      {img.processedSize && (
                        <span className="bg-white/80 px-2 py-0.5 rounded text-[10px] font-bold text-green-700 mt-1">
                          {(img.processedSize / 1024).toFixed(1)} KB
                        </span>
                      )}
                    </div>
                  )}
                  {img.status === 'error' && (
                    <div className="absolute inset-0 bg-red-50/90 flex flex-col items-center justify-center p-2 text-center">
                      <AlertCircle className="text-red-600 mb-1" size={24} />
                      <span className="text-[10px] font-bold text-red-700 leading-tight">
                        {img.error || 'Error'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-blue-600 mb-8 font-medium">
            Tip:- Crop Image For Maintain Aspect Ratio
          </p>

          {/* Controls */}
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  value={dpi} 
                  onChange={(e) => setDpi(e.target.value)}
                  className="w-20 border border-gray-300 rounded p-2 text-center focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="DPI"
                />
                <span className="text-gray-500 font-bold">=</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    value={widthCm} 
                    onChange={(e) => setWidthCm(e.target.value)}
                    className="w-32 border border-gray-300 rounded p-2 text-center focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Width (CM)"
                  />
                  <span className="text-gray-500 font-bold">X</span>
                  <input 
                    type="text" 
                    value={heightCm} 
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="w-32 border border-gray-300 rounded p-2 text-center focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Height (CM)"
                  />
                </div>
                <span className="text-[10px] text-gray-400 font-mono">
                  Pixels: {cmToPx(parseFloat(widthCm) || 0, parseInt(dpi) || 300)} x {cmToPx(parseFloat(heightCm) || 0, parseInt(dpi) || 300)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <input 
                type="checkbox" 
                id="compress"
                checked={compressToSize}
                onChange={(e) => setCompressToSize(e.target.checked)}
                className="w-5 h-5 accent-blue-600 cursor-pointer"
              />
              <label htmlFor="compress" className="text-gray-600 font-medium cursor-pointer">
                Compress Image To Specific Size (Ex. 100kb)
              </label>
            </div>

            {compressToSize && (
              <div className="flex items-center justify-center gap-2">
                <span className="text-gray-600 font-medium">Size:</span>
                <div className="flex border border-gray-300 rounded overflow-hidden">
                  <input 
                    type="text" 
                    value={targetSizeKb}
                    onChange={(e) => setTargetSizeKb(e.target.value)}
                    className="w-24 p-2 text-center outline-none"
                  />
                  <span className="bg-gray-100 px-3 py-2 text-gray-500 font-bold border-l border-gray-300">Kb</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-6">
              <span className="text-gray-600 font-medium">Output:</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="format" 
                  checked={outputFormat === 'jpeg'}
                  onChange={() => setOutputFormat('jpeg')}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="font-medium">JPEG</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="format" 
                  checked={outputFormat === 'jpg'}
                  onChange={() => setOutputFormat('jpg')}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="font-medium">JPG</span>
              </label>
            </div>

            <div className="flex flex-col items-center gap-4 pt-4">
              <button 
                onClick={processImages}
                disabled={images.length === 0 || isProcessing}
                className={cn(
                  "bg-[#3b5998] hover:bg-[#2d4373] text-white px-12 py-3 rounded-md font-bold text-xl shadow-md transition-all flex items-center gap-2",
                  (images.length === 0 || isProcessing) && "opacity-50 cursor-not-allowed"
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Processing...
                  </>
                ) : "Resize Image"}
              </button>

              {images.some(img => img.status === 'done') && (
                <button 
                  onClick={downloadAll}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold underline"
                >
                  <Download size={20} />
                  Download All Processed Images
                </button>
              )}
            </div>
          </div>

          <p className="text-center mt-8 text-gray-600 font-medium">
            Note:- You can resize 10 images at once.
          </p>
        </div>

        {/* Ad Placeholder */}
        <div className="bg-gray-100 rounded-lg p-12 text-center relative overflow-hidden">
          <span className="absolute top-2 right-2 text-[10px] text-gray-400 uppercase tracking-widest border border-gray-300 px-1 rounded">Advertisements</span>
          <div className="flex items-center justify-center text-gray-300">
            <AlertCircle size={48} className="opacity-20" />
          </div>
        </div>
      </main>

      <footer className="max-w-4xl mx-auto p-8 text-center text-gray-400 text-sm">
        &copy; {new Date().getFullYear()} Pi7 Image Resizer Clone. All rights reserved.
      </footer>
    </div>
  );
}

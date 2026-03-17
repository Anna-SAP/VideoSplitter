import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileVideo, Scissors, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Use Vite's ?url to get direct URLs to the assets
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import workerURL from '@ffmpeg/ffmpeg/worker?url';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef<HTMLParagraphElement | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [segmentMinutes, setSegmentMinutes] = useState<number>(5);
  const [segmentSeconds, setSegmentSeconds] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputFiles, setOutputFiles] = useState<{ name: string; url: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    if (loaded || isLoading) return;
    
    if (!ffmpegRef.current) {
      setError("FFmpeg library failed to initialize.");
      return;
    }

    setIsLoading(true);
    setError(null);
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
      console.log(message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
      setProgress(Math.round(progress * 100));
    });

    try {
      await Promise.race([
        ffmpeg.load({
          coreURL,
          wasmURL,
          classWorkerURL: workerURL
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Engine load timeout (60s)')), 60000))
      ]);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load FFmpeg:", err);
      setError(`Failed to load video processing engine: ${err instanceof Error ? err.message : String(err)}. Please check your network or try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setOutputFiles([]);
        setProgress(0);
        setError(null);
      } else {
        setError("Please upload a valid video file.");
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (isProcessing) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setOutputFiles([]);
        setProgress(0);
        setError(null);
      } else {
        setError("Please upload a valid video file.");
      }
    }
  };

  const splitVideo = async () => {
    if (!videoFile) return;
    
    setIsProcessing(true);
    setProgress(0);
    setOutputFiles([]);
    setError(null);

    const ffmpeg = ffmpegRef.current;
    const inputFileName = 'input_video' + videoFile.name.substring(videoFile.name.lastIndexOf('.'));
    const extension = videoFile.name.substring(videoFile.name.lastIndexOf('.'));
    
    try {
      // Write file to FFmpeg virtual file system
      await ffmpeg.writeFile(inputFileName, await fetchFile(videoFile));

      // Calculate duration in seconds
      const durationInSeconds = (segmentMinutes * 60) + segmentSeconds;

      if (durationInSeconds <= 0) {
        throw new Error("Segment duration must be greater than 0 seconds.");
      }

      // Run FFmpeg command to split
      // -c copy: stream copy, no re-encoding (very fast)
      // -map 0: map all streams
      // -segment_time: duration of each segment
      // -f segment: format is segment
      // -reset_timestamps 1: reset timestamps at the beginning of each segment
      await ffmpeg.exec([
        '-i', inputFileName,
        '-c', 'copy',
        '-map', '0',
        '-segment_time', durationInSeconds.toString(),
        '-f', 'segment',
        '-reset_timestamps', '1',
        `output_%03d${extension}`
      ]);

      // Read output files
      const files = await ffmpeg.listDir('/');
      const generatedFiles: { name: string; url: string }[] = [];
      
      for (const file of files) {
        if (file.name.startsWith('output_') && file.name.endsWith(extension)) {
          const data = await ffmpeg.readFile(file.name);
          const blob = new Blob([(data as Uint8Array).buffer], { type: videoFile.type });
          const url = URL.createObjectURL(blob);
          generatedFiles.push({ name: file.name, url });
        }
      }

      // Sort files to ensure correct order
      generatedFiles.sort((a, b) => a.name.localeCompare(b.name));
      setOutputFiles(generatedFiles);

      // Clean up MEMFS
      await ffmpeg.deleteFile(inputFileName);
      for (const file of generatedFiles) {
        await ffmpeg.deleteFile(file.name);
      }

    } catch (err) {
      console.error("Error splitting video:", err);
      setError("An error occurred while splitting the video. The file might be corrupted or unsupported.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadAll = () => {
    outputFiles.forEach((file, index) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = file.url;
        a.download = `${videoFile?.name.replace(/\.[^/.]+$/, "")}_part${index + 1}${file.name.substring(file.name.lastIndexOf('.'))}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 500); // Stagger downloads to prevent browser blocking
    });
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Scissors className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Video Splitter</h1>
          </div>
          <div className="text-sm text-zinc-500 font-medium">
            Client-side Processing
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        
        {/* Intro Section */}
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 mb-3">Split long videos instantly.</h2>
          <p className="text-lg text-zinc-600 leading-relaxed">
            Cut your long videos into shorter segments for social media. Everything happens right in your browser—no uploads, no server limits, complete privacy.
          </p>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Upload Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6">
              <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider mb-4">1. Select Video</h3>
              
              <div 
                className="relative group"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  disabled={isProcessing}
                />
                <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-100' : videoFile ? 'border-indigo-300 bg-indigo-50' : 'border-zinc-300 group-hover:border-indigo-400 group-hover:bg-zinc-50'}`}>
                  {videoFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-2">
                        <FileVideo className="w-6 h-6 text-indigo-600" />
                      </div>
                      <p className="text-sm font-medium text-zinc-900 truncate max-w-full px-4">{videoFile.name}</p>
                      <p className="text-xs text-zinc-500">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-white transition-colors">
                        <UploadCloud className="w-6 h-6 text-zinc-500 group-hover:text-indigo-500 transition-colors" />
                      </div>
                      <p className="text-sm font-medium text-zinc-900">Click or drag video here</p>
                      <p className="text-xs text-zinc-500">MP4, MOV, AVI, MKV up to 2GB</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Settings Card */}
            <div className={`bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 transition-opacity ${!videoFile ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
              <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider mb-4">2. Segment Duration</h3>
              
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    value={segmentMinutes}
                    onChange={(e) => setSegmentMinutes(Math.max(0, Number(e.target.value)))}
                    className="w-24 px-4 py-2.5 bg-zinc-50 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-zinc-900 font-medium text-center"
                  />
                  <span className="text-zinc-600 font-medium">Minutes</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={segmentSeconds}
                    onChange={(e) => setSegmentSeconds(Math.max(0, Math.min(59, Number(e.target.value))))}
                    className="w-24 px-4 py-2.5 bg-zinc-50 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-zinc-900 font-medium text-center"
                  />
                  <span className="text-zinc-600 font-medium">Seconds</span>
                </div>
              </div>
            </div>

            {/* Action Card */}
            <div className={`bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 transition-opacity ${!videoFile ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
              <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider mb-4">3. Process</h3>
              
              <button
                onClick={(!loaded && error) ? load : splitVideo}
                disabled={(!loaded && !error) || isProcessing || (!videoFile && loaded)}
                className="w-full relative flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 px-6 rounded-xl font-medium transition-all disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden group"
              >
                {isProcessing ? (
                  <>
                    <div className="absolute inset-0 bg-indigo-800/20 w-full" style={{ transform: `translateX(-${100 - progress}%)`, transition: 'transform 0.2s ease-out' }}></div>
                    <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                    <span className="relative z-10">Processing... {progress}%</span>
                  </>
                ) : !loaded ? (
                  error ? (
                    <>
                      <AlertCircle className="w-5 h-5" />
                      <span>Retry Loading Engine</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Loading Engine (32MB)...</span>
                    </>
                  )
                ) : (
                  <>
                    <Scissors className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    <span>Start Splitting</span>
                  </>
                )}
              </button>
              
              {/* Hidden log output for debugging if needed */}
              <p ref={messageRef} className="hidden text-xs text-zinc-400 mt-2 font-mono truncate"></p>
            </div>

          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 h-full min-h-[400px] flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Output Segments</h3>
                {outputFiles.length > 0 && (
                  <button 
                    onClick={handleDownloadAll}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download All
                  </button>
                )}
              </div>

              {outputFiles.length > 0 ? (
                <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                  {outputFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 hover:border-zinc-200 transition-all group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium text-zinc-900 truncate">Part {index + 1}</p>
                          <p className="text-xs text-zinc-500 font-mono truncate">{file.name}</p>
                        </div>
                      </div>
                      <a
                        href={file.url}
                        download={`${videoFile?.name.replace(/\.[^/.]+$/, "")}_part${index + 1}${file.name.substring(file.name.lastIndexOf('.'))}`}
                        className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors shrink-0"
                        title="Download segment"
                      >
                        <Download className="w-5 h-5" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-zinc-100 rounded-xl bg-zinc-50/30">
                  {isProcessing ? (
                    <>
                      <div className="w-16 h-16 mb-4 relative">
                        <div className="absolute inset-0 border-4 border-zinc-200 rounded-full"></div>
                        <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                      </div>
                      <p className="text-sm font-medium text-zinc-900">Slicing video...</p>
                      <p className="text-xs text-zinc-500 mt-1">This usually takes just a few seconds.</p>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                        <Scissors className="w-8 h-8 text-zinc-300" />
                      </div>
                      <p className="text-sm font-medium text-zinc-900">No segments yet</p>
                      <p className="text-xs text-zinc-500 mt-1 max-w-[250px]">Upload a video and click "Start Splitting" to see your results here.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

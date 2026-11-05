$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-WinRT($operation,[Type]$type){
    $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1} | Select-Object -First 1
    $task=$method.MakeGenericMethod($type).Invoke($null,@($operation))
    if(-not $task.Wait(20000)){throw 'Screen text recognition timed out.'}
    return $task.Result
}
try {
    $request=[Console]::In.ReadLine() | ConvertFrom-Json
    $fileType=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    $file=Await-WinRT ($fileType::GetFileFromPathAsync($request.path)) $fileType
    $streamType=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
    $stream=Await-WinRT ($file.OpenReadAsync()) $streamType
    try {
        $decoderType=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
        $decoder=Await-WinRT ($decoderType::CreateAsync($stream)) $decoderType
        $pixel=[Windows.Graphics.Imaging.BitmapPixelFormat,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::Bgra8
        $alpha=[Windows.Graphics.Imaging.BitmapAlphaMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::Ignore
        $bitmapType=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
        $bitmap=Await-WinRT ($decoder.GetSoftwareBitmapAsync($pixel,$alpha)) $bitmapType
        try {
            $ocrType=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
            $engine=$ocrType::TryCreateFromUserProfileLanguages()
            if($null -eq $engine){throw 'Install a Windows OCR language pack to read screen text.'}
            $resultType=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
            $result=Await-WinRT ($engine.RecognizeAsync($bitmap)) $resultType
            @{text=$result.Text} | ConvertTo-Json -Compress
        } finally {$bitmap.Dispose()}
    } finally {$stream.Dispose()}
} catch {@{error=$_.Exception.Message} | ConvertTo-Json -Compress}

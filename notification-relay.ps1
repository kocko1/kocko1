$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-WinRT($operation,[Type]$resultType) {
    $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1} | Select-Object -First 1
    $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
    if(-not $task.Wait(10000)){throw 'Windows notifications timed out.'}
    return $task.Result
}
try {
    $request=[Console]::In.ReadLine() | ConvertFrom-Json
    $listener=[Windows.UI.Notifications.Management.UserNotificationListener,Windows.UI.Notifications,ContentType=WindowsRuntime]::Current
    $access=$listener.GetAccessStatus().ToString()
    if($request.mode -eq 'access' -and $access -ne 'Allowed'){
        $type=[Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus,Windows.UI.Notifications,ContentType=WindowsRuntime]
        $access=(Await-WinRT $listener.RequestAccessAsync() $type).ToString()
    }
    if($access -ne 'Allowed'){ @{access=$access;apps=@();notifications=@()} | ConvertTo-Json -Compress;exit }
    $kind=[Windows.UI.Notifications.NotificationKinds,Windows.UI.Notifications,ContentType=WindowsRuntime]::Toast
    $notificationType=[Windows.UI.Notifications.UserNotification,Windows.UI.Notifications,ContentType=WindowsRuntime]
    $listType=[System.Collections.Generic.IReadOnlyList`1].MakeGenericType($notificationType)
    $items=Await-WinRT $listener.GetNotificationsAsync($kind) $listType
    $apps=@{}
    if($request.mode -eq 'apps'){
        foreach($app in Get-StartApps){$apps[$app.AppID]=$app.Name}
    }
    $notifications=@()
    foreach($item in $items){
        $id=$item.AppInfo.AppUserModelId
        $name=$item.AppInfo.DisplayInfo.DisplayName
        $apps[$id]=$name
        if($request.mode -eq 'snapshot' -and $request.selected -ccontains $id -and $item.CreationTime.UtcDateTime -ge [DateTime]::Parse($request.since).ToUniversalTime()){
            $binding=$item.Notification.Visual.GetBinding('ToastGeneric')
            if($null -ne $binding){
                $text=($binding.GetTextElements() | ForEach-Object {$_.Text}) -join '. '
                if($text.Length -gt 600){$text=$text.Substring(0,600)}
                $notifications+=@{id=([string]$item.Id)+'|'+$item.CreationTime.ToString('o');app=$id;name=$name;text=$text}
            }
        }
    }
    $appList=@()
    if($request.mode -eq 'apps'){foreach($id in $apps.Keys){$appList+=@{id=$id;name=$apps[$id]}}}
    @{access=$access;apps=$appList;notifications=$notifications} | ConvertTo-Json -Depth 5 -Compress
} catch {
    @{access='Error';error=$_.Exception.Message;apps=@();notifications=@()} | ConvertTo-Json -Compress
}

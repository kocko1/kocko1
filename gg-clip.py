"""Read GG's clip shortcut; send it only on an explicit clip command."""
import ctypes,json,os,sqlite3,sys,time
from ctypes import wintypes
def shortcut():
    root=os.path.join(os.environ['PROGRAMDATA'],'SteelSeries','GG')
    with sqlite3.connect('file:'+os.path.join(root,'db','database.db').replace('\\','/')+'?mode=ro',uri=True) as c:
        row=c.execute('select trigger_data from keyboard_shortcuts where id=0').fetchone()
    if not row: raise ValueError('Set a Save Clip shortcut in SteelSeries GG.')
    data=json.loads(row[0]);hid=data.get('hidCode',0);mods=data.get('modifiers',0)
    if not isinstance(hid,int) or not isinstance(mods,int) or mods<0 or mods>15:raise ValueError('Unsupported GG shortcut.')
    keys={40:13,41:27,44:32}
    if 4<=hid<=29:vk=65+hid-4
    elif 30<=hid<=38:vk=49+hid-30
    elif hid==39:vk=48
    elif 58<=hid<=69:vk=112+hid-58
    else:vk=keys.get(hid)
    if vk is None:raise ValueError('Use a letter, number or F1-F12 for the GG Save Clip shortcut.')
    with sqlite3.connect('file:'+os.path.join(root,'apps','moments','db','database.db').replace('\\','/')+'?mode=ro',uri=True) as c:
        row=c.execute("select value from moments_settings where key='enabled'").fetchone()
    if row and str(row[0]).lower() in ('false','0'):raise ValueError('Turn on Moments capture in SteelSeries GG first.')
    return vk,mods
def send(vk,mods):
    user=ctypes.WinDLL('user32',use_last_error=True)
    class KEY(ctypes.Structure):_fields_=[('vk',wintypes.WORD),('scan',wintypes.WORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
    class MOUSE(ctypes.Structure):_fields_=[('dx',wintypes.LONG),('dy',wintypes.LONG),('data',wintypes.DWORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
    class UNION(ctypes.Union):_fields_=[('key',KEY),('mouse',MOUSE)]
    class INPUT(ctypes.Structure):_fields_=[('type',wintypes.DWORD),('u',UNION)]
    modifiers=[key for bit,key in [(1,17),(2,16),(4,18),(8,91)] if mods&bit]
    # Don't release keys the user is physically holding.
    for key in [16,17,18,91,92,vk]:
        if user.GetAsyncKeyState(key)&0x8000:raise ValueError('Release keyboard modifiers, then say clip that again.')
    user.SendInput.argtypes=[wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int];user.SendInput.restype=wintypes.UINT
    user.MapVirtualKeyW.argtypes=[wintypes.UINT,wintypes.UINT]
    user.MapVirtualKeyW.restype=wintypes.UINT
    def event(key,up=False):
        scan=user.MapVirtualKeyW(key,0)
        if not scan:raise ValueError('Windows could not map the GG shortcut key.')
        # Scan-code input works with capture hooks; use extended flags where needed.
        flags=8|(2 if up else 0)|(1 if key in (91,92) else 0)
        value=INPUT();value.type=1;value.u.key=KEY(0,scan,flags,0,0)
        if user.SendInput(1,ctypes.byref(value),ctypes.sizeof(INPUT))!=1:
            raise ValueError('Windows blocked the clip shortcut. Check whether GG runs as administrator.')
    held=[]
    try:
        for key in modifiers:
            event(key);held.append(key)
        time.sleep(.06)
        event(vk);held.append(vk)
        time.sleep(.15)
    finally:
        failure=None
        for key in reversed(held):
            try:event(key,True)
            except Exception as error:failure=error
            time.sleep(.02)
        if failure:raise failure

def main():
    try:
        vk,mods=shortcut()
        if '--inspect' in sys.argv:print(json.dumps({'key':vk,'modifiers':mods}))
        else:
            send(vk,mods)
            print('Clipped that, choom.')
    except Exception as error:
        print(str(error));return 1
    return 0

if __name__=='__main__':sys.exit(main())

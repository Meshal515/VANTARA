// Genuine child HWND in Electron's client area. mpv owns its video child;
// Chromium owns controls outside this rectangle. No top-level video window.
using System;
using System.IO;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Collections.Generic;
public static class VideoHost {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd,int command);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
  delegate bool EnumProc(IntPtr hwnd,IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd,EnumProc callback,IntPtr param);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message,IntPtr hwnd,uint min,uint max,uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT {public int left,top,right,bottom;}
  [StructLayout(LayoutKind.Sequential)] struct MSG {public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public POINT point;public uint reserved;}
  [DllImport("user32.dll", SetLastError=true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetClipboardData(uint format,IntPtr memory);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GlobalAlloc(uint flags,UIntPtr bytes);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr memory);
  // CF_HDROP is a real Windows file list, so external applications receive the MP4 file.
  static int CopyFile(string input) {
    string file;
    try {file=Path.GetFullPath(input);if(!File.Exists(file)||!String.Equals(Path.GetExtension(file),".mp4",StringComparison.OrdinalIgnoreCase))return 20;}catch{return 20;}
    byte[] names=Encoding.Unicode.GetBytes(file+"\0\0");
    IntPtr memory=GlobalAlloc(0x0042,new UIntPtr((uint)(20+names.Length)));if(memory==IntPtr.Zero)return 21;
    bool transferred=false,opened=false;
    try {
      IntPtr data=GlobalLock(memory);if(data==IntPtr.Zero)return 21;
      try {Marshal.WriteInt32(data,0,20);Marshal.WriteInt32(data,16,1);Marshal.Copy(names,0,IntPtr.Add(data,20),names.Length);}finally{GlobalUnlock(memory);}
      // Clipboard ownership requires a window on this thread even for a console helper.
      IntPtr owner=CreateWindowEx(0,"STATIC","VANTARA moment share",0,0,0,1,1,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
      if(owner==IntPtr.Zero)return 22;
      try {
        for(int i=0;i<20&&!opened;i++){opened=OpenClipboard(owner);if(!opened)Thread.Sleep(25);}
        if(!opened||!EmptyClipboard())return 22;
        if(SetClipboardData(15,memory)==IntPtr.Zero)return 23;
        transferred=true;return 0;
      }finally{if(opened)CloseClipboard();DestroyWindow(owner);}
    }finally{if(!transferred)GlobalFree(memory);}
  }
  [STAThread]
  public static int Main(string[] args) {
    if(args.Length==2&&args[0]=="--copy-file")return CopyFile(args[1]);
    ulong raw;uint expected,pid;
    if(args.Length!=2||!UInt64.TryParse(args[0],out raw)||raw==0||!UInt32.TryParse(args[1],out expected))return 2;
    IntPtr parent=new IntPtr(unchecked((long)raw));
    if(!IsWindow(parent)||GetWindowThreadProcessId(parent,out pid)==0||pid!=expected)return 3;
    try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
    // WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN; initially hidden.
    IntPtr host=CreateWindowEx(0,"STATIC","VANTARA video",0x46000000,0,0,1,1,parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    if(host==IntPtr.Zero)return 4;
    Console.WriteLine(unchecked((ulong)host.ToInt64()));Console.Out.Flush();
    var lines=new ConcurrentQueue<string>();
    var reader=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length<=160)lines.Enqueue(line);else break;}}catch{}finally{lines.Enqueue("close");}});reader.IsBackground=true;reader.Start();
    try{
      while(IsWindow(parent)&&IsWindow(host)&&GetWindowThreadProcessId(parent,out pid)!=0&&pid==expected){
        string line;
        while(lines.TryDequeue(out line)){
          if(line=="close")return 0;
          if(line=="hide"){ShowWindow(host,0);continue;}
          if(line=="inspect"){
            RECT rect;GetClientRect(host,out rect);var children=new List<string>();
            EnumChildWindows(host,(hwnd,param)=>{var cls=new StringBuilder(128);GetClassName(hwnd,cls,128);RECT childRect;GetClientRect(hwnd,out childRect);
              children.Add(String.Format("{{\"hwnd\":\"{0}\",\"parent\":\"{1}\",\"class\":\"{2}\",\"child\":{3},\"width\":{4},\"height\":{5}}}",unchecked((ulong)hwnd.ToInt64()),unchecked((ulong)GetParent(hwnd).ToInt64()),cls.ToString().Replace("\\","\\\\").Replace("\"","\\\""),(GetWindowLongPtr(hwnd,-16).ToInt64()&0x40000000)!=0?"true":"false",childRect.right,childRect.bottom));return children.Count<32;},IntPtr.Zero);
            Console.WriteLine(String.Format("{{\"event\":\"inspect\",\"host\":\"{0}\",\"parent\":\"{1}\",\"width\":{2},\"height\":{3},\"visible\":{5},\"children\":[{4}]}}",unchecked((ulong)host.ToInt64()),unchecked((ulong)GetParent(host).ToInt64()),rect.right,rect.bottom,String.Join(",",children),IsWindowVisible(host)?"true":"false"));Console.Out.Flush();continue;
          }
          string[] fields=line.Split(' ');int x,y,w,h;
          if(fields.Length!=5||fields[0]!="bounds"||!Int32.TryParse(fields[1],out x)||!Int32.TryParse(fields[2],out y)||!Int32.TryParse(fields[3],out w)||!Int32.TryParse(fields[4],out h)||x<0||y<0||w<0||h<0||x>524288||y>524288||w>524288||h>524288)return 5;
          // SWP_NOACTIVATE preserves keyboard focus on VANTARA controls.
          if(!SetWindowPos(host,IntPtr.Zero,x,y,w,h,0x0010|0x0040))return 6;
        }
        MSG message;while(PeekMessage(out message,IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessage(ref message);}
        Thread.Sleep(10);
      }
      return 0;
    }finally{if(IsWindow(host))DestroyWindow(host);}
  }
}

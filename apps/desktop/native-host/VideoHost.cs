// Genuine child HWND in Electron's client area. mpv owns its video child;
// Chromium owns controls outside this rectangle. No top-level video window.
using System;
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
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] static extern int MapWindowPoints(IntPtr from,IntPtr to,ref POINT point,uint count);
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
  public static int Main(string[] args) {
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
            RECT rect,parentRect,screenRect;GetClientRect(host,out rect);GetClientRect(parent,out parentRect);GetWindowRect(host,out screenRect);
            var origin=new POINT{x=screenRect.left,y=screenRect.top};MapWindowPoints(IntPtr.Zero,parent,ref origin,1);var children=new List<string>();
            EnumChildWindows(host,(hwnd,param)=>{var cls=new StringBuilder(128);GetClassName(hwnd,cls,128);RECT childRect;GetClientRect(hwnd,out childRect);
              children.Add(String.Format("{{\"hwnd\":\"{0}\",\"parent\":\"{1}\",\"class\":\"{2}\",\"child\":{3},\"width\":{4},\"height\":{5}}}",unchecked((ulong)hwnd.ToInt64()),unchecked((ulong)GetParent(hwnd).ToInt64()),cls.ToString().Replace("\\","\\\\").Replace("\"","\\\""),(GetWindowLongPtr(hwnd,-16).ToInt64()&0x40000000)!=0?"true":"false",childRect.right,childRect.bottom));return children.Count<32;},IntPtr.Zero);
            Console.WriteLine(String.Format("{{\"event\":\"inspect\",\"host\":\"{0}\",\"parent\":\"{1}\",\"width\":{2},\"height\":{3},\"visible\":{5},\"x\":{6},\"y\":{7},\"parentWidth\":{8},\"parentHeight\":{9},\"children\":[{4}]}}",unchecked((ulong)host.ToInt64()),unchecked((ulong)GetParent(host).ToInt64()),rect.right,rect.bottom,String.Join(",",children),IsWindowVisible(host)?"true":"false",origin.x,origin.y,parentRect.right,parentRect.bottom));Console.Out.Flush();continue;
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

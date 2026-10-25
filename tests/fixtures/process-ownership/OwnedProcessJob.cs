using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// A task-owned process tree. The job is unnamed, non-inheritable and has no
// breakaway or new CPU/memory policy. Existing workload limits remain in force.
public static class OwnedProcessJob {
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=Int32.MaxValue};
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {public Int64 ProcessTime,JobTime;public UInt32 Flags;public UIntPtr MinWS,MaxWS;public UInt32 ActiveLimit;public UIntPtr Affinity;public UInt32 Priority,Scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {public UInt64 ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
  [StructLayout(LayoutKind.Sequential)] struct Accounting {public Int64 UserTime,KernelTime,ThisUser,ThisKernel;public UInt32 PageFaults,TotalProcesses,ActiveProcesses,TerminatedProcesses;}
  [StructLayout(LayoutKind.Sequential)] struct Security {public Int32 Size;public IntPtr Descriptor;[MarshalAs(UnmanagedType.Bool)]public bool Inherit;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public Int32 Size;public string Reserved,Desktop,Title;public UInt32 X,Y,XSize,YSize,XChars,YChars,Fill,Flags;public UInt16 Show,ReservedSize;public IntPtr ReservedData,StdIn,StdOut,StdErr;}
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr Process,Thread;public UInt32 Pid,Tid;}
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,Int32 kind,IntPtr info,UInt32 length);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(IntPtr job,Int32 kind,IntPtr info,UInt32 length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateJobObject(IntPtr job,UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)]static extern UInt32 ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)]static extern UInt32 WaitForSingleObject(IntPtr handle,UInt32 milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr process,out UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern IntPtr CreateFile(string path,UInt32 access,UInt32 share,ref Security security,UInt32 creation,UInt32 flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,UInt32 flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);
  static void Check(bool ok,string stage){if(!ok)throw new InvalidOperationException(stage+"_WIN32_"+Marshal.GetLastWin32Error());}
  static void Write(string path,object value){string temporary=path+".tmp";File.WriteAllText(temporary,Json.Serialize(value),new UTF8Encoding(false));File.Move(temporary,path);}
  static T Get<T>(IntPtr job,int kind)where T:struct{int length=Marshal.SizeOf(typeof(T));IntPtr ptr=Marshal.AllocHGlobal(length);try{Check(QueryInformationJobObject(job,kind,ptr,(UInt32)length,IntPtr.Zero),"QUERY_JOB");return(T)Marshal.PtrToStructure(ptr,typeof(T));}finally{Marshal.FreeHGlobal(ptr);}}
  static string Quote(string value){StringBuilder b=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);slashes=0;continue;}b.Append('\\',slashes);slashes=0;b.Append(c);}b.Append('\\',slashes*2);return b.Append('"').ToString();}
  static StringBuilder Command(string executable,IEnumerable<string> args,bool verbatim){StringBuilder b=new StringBuilder(Quote(executable));foreach(string arg in args)b.Append(' ').Append(verbatim?arg:Quote(arg));return b;}
  static IntPtr Output(string path){Security s=new Security{Size=Marshal.SizeOf(typeof(Security)),Inherit=true};IntPtr value=CreateFile(path,0x40000000,3,ref s,2,0x80,IntPtr.Zero);Check(value!=new IntPtr(-1),"OPEN_OUTPUT");return value;}
  static List<object> Members(IntPtr job){const int size=65536;IntPtr ptr=Marshal.AllocHGlobal(size);try{Check(QueryInformationJobObject(job,3,ptr,size,IntPtr.Zero),"JOB_MEMBERS");int count=Marshal.ReadInt32(ptr,4);if(count<0||count>4096)throw new InvalidOperationException("MEMBER_LIMIT");List<object> result=new List<object>();for(int index=0;index<count;index++){int pid=Marshal.ReadIntPtr(ptr,8+index*IntPtr.Size).ToInt32();try{using(Process p=Process.GetProcessById(pid)){if(p.HasExited)continue;bool member;Check(IsProcessInJob(p.Handle,job,out member)&&member,"MEMBERSHIP");result.Add(new{pid=pid,created_utc=p.StartTime.ToUniversalTime().ToString("o"),image=p.ProcessName,job_descendant=true});}}catch(ArgumentException){}catch(InvalidOperationException){try{using(Process p=Process.GetProcessById(pid)){if(!p.HasExited)throw;}}catch(ArgumentException){}}}return result;}finally{Marshal.FreeHGlobal(ptr);}}
  public static int Main(string[] args){
    if(args.Length!=1)return 2;
    Dictionary<string,object> spec=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
    string root=Path.GetDirectoryName(args[0]),executable=(string)spec["executable"],cwd=(string)spec["cwd"],profile=spec.ContainsKey("profile")?(string)spec["profile"]:null;
    int ownerPid=Convert.ToInt32(spec["owner_pid"]),timeout=Convert.ToInt32(spec["timeout_ms"]);long maxOutput=Convert.ToInt64(spec["max_output_bytes"]);
    List<string> arguments=new List<string>();foreach(object value in(System.Collections.IEnumerable)spec["args"])arguments.Add((string)value);
    IntPtr job=IntPtr.Zero,stdout=IntPtr.Zero,stderr=IntPtr.Zero;ProcessInfo child=new ProcessInfo();Process owner=null;
    string status="FAILED",error=null;UInt32? exit=null;UInt32 remaining=0;bool forced=false;Stopwatch elapsed=Stopwatch.StartNew();
    try{
      owner=Process.GetProcessById(ownerPid);IntPtr ownerHandle=owner.Handle;if(owner.HasExited)throw new InvalidOperationException("OWNER_EXITED_BEFORE_START");
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CREATE_JOB");ExtendedLimit limit=new ExtendedLimit();limit.Basic.Flags=0x2000;
      int length=Marshal.SizeOf(typeof(ExtendedLimit));IntPtr limits=Marshal.AllocHGlobal(length);try{Marshal.StructureToPtr(limit,limits,false);Check(SetInformationJobObject(job,9,limits,(UInt32)length),"SET_KILL_ON_CLOSE");}finally{Marshal.FreeHGlobal(limits);}
      stdout=Output(Path.Combine(root,"stdout.log"));stderr=Output(Path.Combine(root,"stderr.log"));
      Startup startup=new Startup{Size=Marshal.SizeOf(typeof(Startup)),Flags=0x100,StdOut=stdout,StdErr=stderr};
      Check(CreateProcess(executable,Command(executable,arguments,Convert.ToBoolean(spec["verbatim"])),IntPtr.Zero,IntPtr.Zero,true,4|0x08000000|0x400,IntPtr.Zero,cwd,ref startup,out child),"CREATE_SUSPENDED");
      Check(AssignProcessToJobObject(job,child.Process),"ASSIGN_SUSPENDED");bool inside;Check(IsProcessInJob(child.Process,job,out inside)&&inside,"MEMBERSHIP_BEFORE_RESUME");
      using(Process process=Process.GetProcessById((int)child.Pid))Write(Path.Combine(root,"started.json"),new{schema_version=1,kind="WIN32_OWNED_JOB",owner_pid=ownerPid,owner_created_utc=owner.StartTime.ToUniversalTime().ToString("o"),supervisor_pid=Process.GetCurrentProcess().Id,root_pid=child.Pid,root_parent_pid=Process.GetCurrentProcess().Id,root_created_utc=process.StartTime.ToUniversalTime().ToString("o"),profile=profile,suspended_assigned_before_execution=true,verified_member_before_resume=inside,breakaway_allowed=false,kill_on_close=true});
      Check(ResumeThread(child.Thread)!=0xffffffff,"RESUME");CloseHandle(child.Thread);child.Thread=IntPtr.Zero;
      using(StreamWriter samples=new StreamWriter(Path.Combine(root,"members.jsonl"),false,new UTF8Encoding(false))){for(;;){samples.WriteLine(Json.Serialize(new{elapsed_ms=elapsed.ElapsedMilliseconds,members=Members(job)}));samples.Flush();
        if(WaitForSingleObject(child.Process,0)==0){UInt32 code;Check(GetExitCodeProcess(child.Process,out code),"EXIT_CODE");exit=code;status="COMPLETED";break;}
        if(timeout>0&&elapsed.ElapsedMilliseconds>=timeout){status="TIMEOUT";error="WORKLOAD_DEADLINE";break;}
        if(new FileInfo(Path.Combine(root,"stdout.log")).Length>maxOutput||new FileInfo(Path.Combine(root,"stderr.log")).Length>maxOutput){status="FAILED";error="OUTPUT_LIMIT";break;}
        if(File.Exists(Path.Combine(root,"terminate"))){status="STOPPED";break;}if(owner.HasExited){status="OWNER_EXITED";break;}
        Thread.Sleep(50);
      }}
    }catch(Exception failure){error=failure is InvalidOperationException?failure.Message:"NATIVE_"+failure.GetType().Name;status="FAILED";}
    finally{
      if(child.Thread!=IntPtr.Zero)CloseHandle(child.Thread);
      if(job!=IntPtr.Zero){if(Get<Accounting>(job,1).ActiveProcesses>0){forced=true;TerminateJobObject(job,124);Stopwatch deadline=Stopwatch.StartNew();while(Get<Accounting>(job,1).ActiveProcesses>0&&deadline.ElapsedMilliseconds<10000)Thread.Sleep(25);}remaining=Get<Accounting>(job,1).ActiveProcesses;CloseHandle(job);}
      // If assignment failed, the suspended root never belonged to the job.
      if(child.Process!=IntPtr.Zero){if(WaitForSingleObject(child.Process,0)!=0){TerminateProcess(child.Process,125);if(WaitForSingleObject(child.Process,10000)!=0){status="FAILED";error="ROOT_NOT_STOPPED";remaining=Math.Max(remaining,1);}}CloseHandle(child.Process);}
      if(stdout!=IntPtr.Zero)CloseHandle(stdout);if(stderr!=IntPtr.Zero)CloseHandle(stderr);if(owner!=null)owner.Dispose();
      Write(Path.Combine(root,"closed.json"),new{schema_version=1,kind="WIN32_OWNED_JOB",status=status,root_pid=child.Pid,root_exit_code=exit,error_code=error,forced_cleanup=forced,cleanup_active_processes=remaining,elapsed_ms=elapsed.ElapsedMilliseconds});
    }
    return remaining==0&&status=="COMPLETED"?(int)(exit??1):remaining==0&&(status=="STOPPED"||status=="OWNER_EXITED")?0:1;
  }
}

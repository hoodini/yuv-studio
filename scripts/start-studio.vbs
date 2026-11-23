' Starts YUV.AI Studio with no window. Used by the "YUV Studio" scheduled task at Windows logon.
' Output goes to data\studio.log (overwritten on each start).
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run "cmd /c npm start > ""data\studio.log"" 2>&1", 0, False

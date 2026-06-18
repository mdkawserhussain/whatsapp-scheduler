' start.vbs — Silent background launcher for WhatsApp Scheduler
' Double-click this file (or add it to Windows Startup) to run
' index.js invisibly with no console window.
'
' To add to Windows Startup:
'   1. Press Win + R → type: shell:startup → Enter
'   2. Create a shortcut to this .vbs file in that folder

Dim oShell
Set oShell = CreateObject("WScript.Shell")

' Auto-detect the folder where this .vbs file is located
Dim sFolder
sFolder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
oShell.CurrentDirectory = sFolder

' Run node index.js with window hidden (0 = no window, False = don't wait)
oShell.Run "node index.js", 0, False

Set oShell = Nothing

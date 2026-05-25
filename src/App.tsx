import React, { useState, useEffect, useRef } from "react";
import { Task, TaskPriority, TaskStatus, ChatMessage, ChatAction, UserProfile } from "./types";
import { INITIAL_TASKS } from "./initial_tasks";
import ChatPanel from "./components/ChatPanel";
import TaskItem from "./components/TaskItem";
import TaskForm from "./components/TaskForm";
import AuthScreen from "./components/AuthScreen";
import { Sparkles, Terminal, Shield, RefreshCw, Layers, Plus, Search, Filter, Trash, Play, RefreshCcw, LogOut } from "lucide-react";

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome-msg",
    sender: "assistant",
    text: "Hello! I'm the TaskChatbot. I see you just deployed me using Docker. How can I help you manage your work items today?",
    timestamp: new Date().toISOString()
  }
];

const INITIAL_LOGS = [
  `[${new Date().toLocaleTimeString()}] info: Microsoft.Hosting.Lifetime[0] Application started. Press Ctrl+C to shut down.`,
  `[${new Date().toLocaleTimeString()}] info: Microsoft.Hosting.Lifetime[0] Hosting environment: Production`,
  `[${new Date().toLocaleTimeString()}] info: Microsoft.Hosting.Lifetime[0] Content root path: /app/workspace`,
  `$ docker build -t task-chatbot .`,
  `Step 1/11 : FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build ... DONE`,
  `Step 2/11 : WORKDIR /src ... OK`,
  `Step 11/11 : ENTRYPOINT ["dotnet", "TaskChatbot.dll"] ... EXPOSED (PORT 3000)`,
  `$ [SYSTEM] Querying local SQLite database... OK`,
  `> Task Chatbot is up and listening for dynamic instructions.`
];

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem("high_density_tasks");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Task[];
        const existingIds = new Set(parsed.map(t => t.id));
        const missingTasks = INITIAL_TASKS.filter(t => !existingIds.has(t.id));
        if (missingTasks.length > 0) {
          return [...parsed, ...missingTasks];
        }
        return parsed;
      } catch (e) {
        console.error("Failed to parse saved tasks, falling back to initial seed:", e);
      }
    }
    return INITIAL_TASKS;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("high_density_messages");
    return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
  });

  const [terminalLogs, setTerminalLogs] = useState<string[]>(INITIAL_LOGS);
  const [activeSidebar, setActiveSidebar] = useState<"chat" | "tasks" | "settings" | "docker">("chat");
  const [isPending, setIsPending] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem("high_density_user");
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem("high_density_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("high_density_user");
    }
  }, [user]);
  
  // Tasks filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");

  // Form Modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Save to LocalStorage
  useEffect(() => {
    localStorage.setItem("high_density_tasks", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("high_density_messages", JSON.stringify(messages));
  }, [messages]);

  // Auto scroll console terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  const addLog = (line: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLogs((prev) => [...prev, `[${timestamp}] ${line}`]);
  };

  // Chat message submission
  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: "msg-" + Date.now(),
      sender: "user",
      text,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    addLog(`$ task-chatbot query --prompt "${text}"`);
    setIsPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: updatedMessages.slice(-8), // Send last 8 chats for context
          currentTasks: tasks
        })
      });

      if (!response.ok) {
        let errMsg = `API returned code ${response.status}`;
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errMsg = `${errData.error} (Status: ${response.status})`;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      
      const assistantMsg: ChatMessage = {
        id: "msg-" + (Date.now() + 1),
        sender: "assistant",
        text: data.reply || "I processed your prompt successfully.",
        timestamp: new Date().toISOString(),
        actions: data.actions || []
      };

      setMessages((prev) => [...prev, assistantMsg]);
      addLog(`[GEMINI] Assistant reply received. Status: 200 OK`);

      // Handle server-directed task modifications
      if (data.actions && Array.isArray(data.actions)) {
        data.actions.forEach((action: ChatAction) => {
          handleAIAction(action);
        });
      }

    } catch (err: any) {
      console.error(err);
      addLog(`[ALERT] Failed server proxy response: ${err.message || err}`);
      
      const assistantErrorMsg: ChatMessage = {
        id: "msg-" + (Date.now() + 1),
        sender: "assistant",
        text: "I met an issue reaching the server-side proxy. Please ensure the GEMINI_API_KEY secret is verified in your settings block, or try again.",
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, assistantErrorMsg]);
    } finally {
      setIsPending(false);
    }
  };

  // Client Side UI task manipulation
  const handleToggleTaskStatus = (id: string) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id === id) {
          const isTaskDone = task.status === TaskStatus.DONE || task.status === TaskStatus.COMPLETED || task.status.toLowerCase() === "done" || task.status.toLowerCase() === "completed";
          const nextStatus = isTaskDone ? TaskStatus.NEW : TaskStatus.DONE;
          
          addLog(`[STATUS UPDATE] Task "${task.title.slice(0, 24)}" updated status to: ${nextStatus}.`);
          return { ...task, status: nextStatus };
        }
        return task;
      })
    );
  };

  const handleDeleteTask = (id: string) => {
    const target = tasks.find(t => t.id === id);
    setTasks((current) => current.filter((task) => task.id !== id));
    addLog(`[DELETE] Object ID ${id} removed successfully from local context database.`);
  };

  const handleOpenCreateForm = () => {
    setTaskToEdit(null);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (task: Task) => {
    setTaskToEdit(task);
    setIsFormOpen(true);
  };

  const handleFormSubmit = (taskData: Omit<Task, "id" | "createdAt"> & { id?: string }) => {
    if (taskData.id) {
      // Edit
      setTasks((current) =>
        current.map((t) =>
          t.id === taskData.id
            ? {
                ...t,
                title: taskData.title,
                description: taskData.description,
                status: taskData.status,
                priority: taskData.priority,
                dueDate: taskData.dueDate,
                category: taskData.category
              }
            : t
        )
      );
      addLog(`[DATABASE UPDATE] Task ID ${taskData.id} manually edited successfully.`);
    } else {
      // Create new
      const newTask: Task = {
        id: "task-" + Date.now(),
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        priority: taskData.priority,
        dueDate: taskData.dueDate,
        category: taskData.category,
        createdAt: new Date().toISOString()
      };
      setTasks((current) => [newTask, ...current]);
      addLog(`[RECORD CREATED] Task "${taskData.title.slice(0, 24)}" generated under ID ${newTask.id}.`);
    }
    setIsFormOpen(false);
  };

  // Dynamically execute actions generated by standard LLM outputs
  const handleAIAction = (action: ChatAction) => {
    if (!action || !action.type) return;

    switch (action.type) {
      case "ADD_TASK": {
        const payload = action.payload || {};
        if (!payload.title) return;
        const newTask: Task = {
          id: "task-" + Date.now() + Math.floor(Math.random() * 100),
          title: payload.title,
          description: payload.description || "",
          status: (payload.status as TaskStatus) || TaskStatus.NEW,
          priority: (payload.priority as TaskPriority) || TaskPriority.MEDIUM,
          dueDate: payload.dueDate || undefined,
          category: payload.category || "AI Assistant",
          createdAt: new Date().toISOString()
        };
        setTasks((prev) => [newTask, ...prev]);
        addLog(`[AI SCHEDULER] Automatically generated task "${newTask.title.slice(0, 28)}" in database.`);
        break;
      }
      case "COMPLETE_TASK": {
        const targetId = action.payload?.id;
        if (!targetId) return;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === targetId || t.title.toLowerCase().includes(targetId)
              ? { ...t, status: TaskStatus.DONE }
              : t
          )
        );
        addLog(`[AI SCHEDULER] Marked matching task ID or tag "${targetId}" as DONE.`);
        break;
      }
      case "UPDATE_TASK": {
        const payload = action.payload || {};
        if (!payload.id) return;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === payload.id
              ? {
                  ...t,
                  title: payload.title || t.title,
                  description: payload.description || t.description,
                  status: (payload.status as TaskStatus) || t.status,
                  priority: (payload.priority as TaskPriority) || t.priority,
                  dueDate: payload.dueDate || t.dueDate,
                  category: payload.category || t.category
                }
              : t
          )
        );
        addLog(`[AI SCHEDULER] Restructured details for task ID ${payload.id}.`);
        break;
      }
      case "DELETE_TASK": {
        const targetId = action.payload?.id;
        if (!targetId) return;
        setTasks((prev) => prev.filter((t) => t.id !== targetId));
        addLog(`[AI SCHEDULER] Automatic purging executed for task ID: ${targetId}.`);
        break;
      }
      default:
        break;
    }
  };

  // Restart logging/system action simulation
  const handleResetWorkspace = () => {
    localStorage.removeItem("high_density_tasks");
    localStorage.removeItem("high_density_messages");
    setTasks(INITIAL_TASKS);
    setMessages(INITIAL_MESSAGES);
    setTerminalLogs([
      `[${new Date().toLocaleTimeString()}] [SYSTEM] Reboot requested. Hard clean.`,
      `[${new Date().toLocaleTimeString()}] Reseeding default SQLite structures...`,
      `[${new Date().toLocaleTimeString()}] Database reconnected successfully. Active connections: 2`
    ]);
  };

  // Filtering Logic
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (task.category && task.category.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "ALL" || task.status === statusFilter;

    const matchesPriority =
      priorityFilter === "ALL" || task.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  const totalItemCount = tasks.length;
  const completedCount = tasks.filter((t) => t.status === TaskStatus.DONE || t.status === TaskStatus.COMPLETED || t.status.toLowerCase() === "done" || t.status.toLowerCase() === "completed").length;
  const pendingCount = totalItemCount - completedCount;

  if (!user) {
    return (
      <AuthScreen 
        onLoginSuccess={(authorizedUser) => {
          setUser(authorizedUser);
          setTerminalLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] [AUTH] Successfully authenticated as "${authorizedUser.name}" via ${authorizedUser.provider.toUpperCase()}.`
          ]);
        }} 
      />
    );
  }

  return (
    <div id="workspace-root" className="h-screen w-full bg-[#0F1115] text-[#E0E0E0] font-sans flex flex-col overflow-hidden select-none">
      
      {/* Top Header Section */}
      <header className="height-[56px] min-h-[56px] bg-[#161B22] border-b border-[#2D3139] display-flex flex items-center justify-between px-5 py-2.5 z-10">
        <div className="flex items-center gap-3">
          {/* Logo icon representation */}
          <div className="w-8 h-8 bg-[#3B82F6] rounded-md flex items-center justify-center font-black text-white text-base tracking-wider select-none shadow-sm shadow-blue-500/20">
            T
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#F8FAFC] tracking-tight text-sm md:text-base">TaskChatbot</span>
              <span className="text-[10px] bg-[#2D3139] text-[#8B949E] px-1.5 py-0.5 rounded-md font-mono border border-[#2D3139]">v2.1.0</span>
            </div>
          </div>
        </div>

        {/* Development & Server Docker runtime metrics */}
        <div className="flex items-center gap-2 md:gap-4 font-mono">
          {user && (
            <div className="flex items-center gap-2 bg-[#090B0E] border border-[#2D3139] rounded-lg p-1 px-2.5 shrink-0 select-none">
              {user.avatarUrl ? (
                <img 
                  src={user.avatarUrl} 
                  alt={user.name} 
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full object-cover border border-[#2D3139]" 
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-blue-600/25 border border-blue-500/35 text-blue-400 font-bold flex items-center justify-center text-[10px] uppercase font-sans">
                  {user.name.charAt(0)}
                </div>
              )}
              <div className="hidden sm:flex flex-col text-left justify-center min-w-0 font-sans">
                <span className="text-[11px] font-semibold text-white leading-none tracking-tight truncate max-w-[80px]">
                  {user.name}
                </span>
                <span className="text-[8px] text-blue-400 uppercase font-mono tracking-wider font-bold leading-none mt-0.5">
                  {user.provider}
                </span>
              </div>
              <button
                id="header-logout-btn"
                onClick={() => {
                  setUser(null);
                  setTerminalLogs((prev) => [
                    ...prev,
                    `[${new Date().toLocaleTimeString()}] [AUTH] Terminated session for "${user.name}" (sign-off).`
                  ]);
                }}
                className="ml-1.5 p-1 rounded-md text-[#8B949E] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="hidden md:flex items-center gap-2 text-xs bg-[#161B22] border border-[#2D3139] rounded-lg px-2.5 py-1 text-[#3B82F6]">
            <span className="w-1.5 h-1.5 bg-[#3B82F6] rounded-full animate-ping"></span>
            <span>Docker: Running</span>
          </div>
          <div className="flex items-center gap-2 text-xs bg-[#161B22] border border-[#2D3139] rounded-lg px-2.5 py-1 text-[#4ADE80]">
            <span className="w-1.5 h-1.5 bg-[#4ADE80] rounded-full"></span>
            <span>Local: 3000</span>
          </div>
          <button 
            id="workspace-reset-btn"
            onClick={handleResetWorkspace}
            title="Clean Database & Reset Chats"
            className="p-1 px-2 rounded-md bg-[#252A33] border border-[#2D3139] hover:border-rose-400/50 hover:bg-rose-500/10 text-[#8B949E] hover:text-rose-400 text-xs flex items-center gap-1 cursor-pointer transition-all"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Main Container Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Toolbar Sidebar */}
        <aside className="w-16 bg-[#090B0E] border-r border-[#2D3139] flex flex-col items-center justify-between py-4 select-none">
          <div className="flex flex-col gap-4 w-full px-2">
            <button
              id="sidebar-chat-tab"
              onClick={() => {
                setActiveSidebar("chat");
                addLog(`[UI FOCUS] Shifted primary focus context viewport to: CHAT-ASSISTANT`);
              }}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
                activeSidebar === "chat"
                  ? "bg-[#3B82F6]/15 border border-[#3B82F6] text-[#3B82F6]"
                  : "text-[#8B949E] hover:text-[#E0E0E0] hover:bg-[#161B22] border border-transparent"
              }`}
              title="Chat Assistant"
            >
              <span className="text-xl">💬</span>
              {activeSidebar === "chat" && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#3B82F6] rounded-l-md" />
              )}
            </button>

            <button
              id="sidebar-tasks-tab"
              onClick={() => {
                setActiveSidebar("tasks");
                addLog(`[UI FOCUS] Shifted primary focus context viewport to: WORKITEMS-DB`);
              }}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
                activeSidebar === "tasks"
                  ? "bg-[#3B82F6]/15 border border-[#3B82F6] text-[#3B82F6]"
                  : "text-[#8B949E] hover:text-[#E0E0E0] hover:bg-[#161B22] border border-transparent"
              }`}
              title="Interactive Work Items"
            >
              <span className="text-xl">📋</span>
              <div className="absolute -top-1 -right-1 bg-red-500 text-white font-mono text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-bold">
                {pendingCount}
              </div>
              {activeSidebar === "tasks" && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#3B82F6] rounded-l-md" />
              )}
            </button>

            <button
              id="sidebar-logs-tab"
              onClick={() => {
                setActiveSidebar("settings");
                addLog(`[UI EVENT] Triggered diagnostic details readout callback.`);
              }}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
                activeSidebar === "settings"
                  ? "bg-[#3B82F6]/15 border border-[#3B82F6] text-[#3B82F6]"
                  : "text-[#8B949E] hover:text-[#E0E0E0] hover:bg-[#161B22] border border-transparent"
              }`}
              title="System Metadata"
            >
              <span className="text-xl">⚙️</span>
              {activeSidebar === "settings" && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#3B82F6] rounded-l-md" />
              )}
            </button>

            <button
              id="sidebar-docker-tab"
              onClick={() => {
                setActiveSidebar("docker");
                addLog(`[SYSTEM] Initiating local image telemetry query state... SUCCESS`);
              }}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
                activeSidebar === "docker"
                  ? "bg-[#3B82F6]/15 border border-[#3B82F6] text-[#3B82F6]"
                  : "text-[#8B949E] hover:text-[#E0E0E0] hover:bg-[#161B22] border border-transparent"
              }`}
              title="Docker Platform Node"
            >
              <span className="text-xl">🐳</span>
              {activeSidebar === "docker" && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#3B82F6] rounded-l-md" />
              )}
            </button>
          </div>

          <div className="flex flex-col gap-1 items-center select-none text-[10px] text-[#8B949E]/50 font-mono">
            <span>SYS</span>
            <span className="text-emerald-500 font-bold">OK</span>
          </div>
        </aside>

        {/* Dashboard workspace core view */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#090B0E]">
          
          {/* Middle view: Chat area (occupies left on wide displays, or full when tabbed) */}
          <div className={`flex-1 flex flex-col p-4 overflow-hidden h-full ${
            activeSidebar !== "chat" ? "hidden md:flex" : "flex"
          }`}>
            <ChatPanel 
              messages={messages} 
              onSendMessage={handleSendMessage} 
              isPending={isPending} 
            />
          </div>

          {/* Right/Second Workspace Panel: Database Work Items */}
          <div className={`w-full md:w-[480px] lg:w-[560px] border-l border-[#2D3139] bg-[#090B0E] flex flex-col h-full overflow-hidden ${
            activeSidebar === "chat" ? "hidden md:flex" : "flex"
          }`}>
            
            {/* Database header block */}
            <div className="px-5 py-4 border-b border-[#2D3139] bg-[#161B22] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                  <span>📋 Local WorkItems DB</span>
                  <span className="text-xs text-[#3B82F6]">({filteredTasks.length})</span>
                </h2>
                <span className="text-[10px] text-[#8B949E] block mt-0.5 font-mono">
                  Persisted SQLite Engine proxy loaded online
                </span>
              </div>
              
              <button
                id="create-task-form-btn"
                onClick={handleOpenCreateForm}
                className="px-3 py-1.5 bg-[#3B82F6] hover:bg-blue-600 font-bold text-xs text-white rounded-lg flex items-center gap-1 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            {/* Quick dashboard interactive metrics */}
            <div className="grid grid-cols-3 divide-x divide-[#2D3139] border-b border-[#2D3139] bg-[#161B22]/30 text-xs text-center">
              <div className="py-2.5">
                <span className="block text-[10px] text-[#8B949E] font-bold uppercase font-mono mb-0.5">Total count</span>
                <span className="text-sm font-bold text-white">{totalItemCount}</span>
              </div>
              <div className="py-2.5">
                <span className="block text-[10px] text-[#8B949E] font-bold uppercase font-mono mb-0.5">Pending</span>
                <span className="text-sm font-bold text-[#3B82F6]">{pendingCount}</span>
              </div>
              <div className="py-2.5">
                <span className="block text-[10px] text-[#8B949E] font-bold uppercase font-mono mb-0.5">Completed</span>
                <span className="text-sm font-bold text-emerald-400">{completedCount}</span>
              </div>
            </div>

            {/* Database Query & Filtering Controls */}
            <div className="p-3 bg-[#161B22]/50 border-b border-[#2D3139] space-y-2">
              <div className="flex items-center gap-2 bg-[#090B0E] border border-[#2D3139] rounded-lg px-2.5 py-1.5">
                <Search className="w-3.5 h-3.5 text-[#8B949E] shrink-0" />
                <input
                  id="task-search-input"
                  type="text"
                  placeholder="Query tasks, description, tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-none text-xs text-white placeholder-[#8B949E] outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-[#8B949E] hover:text-white text-xs font-mono cursor-pointer">
                    Clear
                  </button>
                )}
              </div>

              <div className="flex gap-2 text-[10px] font-mono">
                <div className="flex-1 flex items-center gap-1 bg-[#090B0E] border border-[#2D3139] rounded-md px-2 py-1">
                  <span className="text-[#8B949E]">Status:</span>
                  <select
                    id="status-filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="flex-1 bg-transparent text-white border-none outline-none cursor-pointer font-sans"
                  >
                    <option value="ALL" className="bg-[#090B0E]">ALL</option>
                    <option value={TaskStatus.NEW} className="bg-[#090B0E]">New</option>
                    <option value={TaskStatus.IN_PROGRESS} className="bg-[#090B0E]">In progress</option>
                    <option value={TaskStatus.CODE_COMPLETED} className="bg-[#090B0E]">code completed</option>
                    <option value={TaskStatus.WAITING_FOR_QA} className="bg-[#090B0E]">waiting for QA</option>
                    <option value={TaskStatus.READY} className="bg-[#090B0E]">ready</option>
                    <option value={TaskStatus.DONE} className="bg-[#090B0E]">done</option>
                  </select>
                </div>

                <div className="flex-1 flex items-center gap-1 bg-[#090B0E] border border-[#2D3139] rounded-md px-2 py-1">
                  <span className="text-[#8B949E]">Priority:</span>
                  <select
                    id="priority-filter-select"
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="flex-1 bg-transparent text-white border-none outline-none cursor-pointer font-sans"
                  >
                    <option value="ALL" className="bg-[#090B0E]">ALL</option>
                    <option value={TaskPriority.LOW} className="bg-[#090B0E]">Low</option>
                    <option value={TaskPriority.MEDIUM} className="bg-[#090B0E]">Medium</option>
                    <option value={TaskPriority.HIGH} className="bg-[#090B0E]">High</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Task list container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredTasks.length > 0 ? (
                filteredTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggleStatus={handleToggleTaskStatus}
                    onDelete={handleDeleteTask}
                    onEdit={handleOpenEditForm}
                  />
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#2D3139] rounded-xl bg-[#161B22]/10">
                  <Layers className="w-8 h-8 text-[#8B949E]/40 mb-2.5" />
                  <p className="text-xs text-white font-semibold">No Matching WorkItems</p>
                  <p className="text-[11px] text-[#8B949E] mt-1 max-w-[240px]">
                    Your SQLite filters returned empty. Ask Gemini to schedule new tasks or click &quot;Add Item&quot;.
                  </p>
                </div>
              )}
            </div>

            {/* Platform & Server debug readout module */}
            <div className="p-3 bg-[#161B22] border-t border-[#2D3139] text-[11px] font-mono text-[#8B949E]">
              <div className="flex justify-between py-0.5">
                <span>Platform:</span>
                <span className="text-white">Docker Desktop OS</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Base Image:</span>
                <span className="text-white">mcr.microsoft.com/aspnet:8.0</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Build hash:</span>
                <span className="text-[#3B82F6]">8f2c3a91-aistudio</span>
              </div>
            </div>

          </div>
        </main>
      </div>

      {/* Bottom Footer Terminal - Height 120px with Scrolling Server output */}
      <footer className="h-[120px] min-h-[120px] bg-[#050608] border-t border-[#2D3139] p-3 text-xs font-mono overflow-y-auto relative select-text z-10 selection:bg-[#3B82F6]/30">
        <div className="absolute right-3.5 top-2 px-2 py-0.5 rounded-md bg-[#161B22] border border-[#2D3139] text-[9px] text-[#8B949E] font-bold uppercase select-none tracking-widest flex items-center gap-1.5">
          <Terminal className="w-3 h-3 text-[#3B82F6]" />
          <span>Interactive Shell Console</span>
        </div>
        
        <div className="space-y-1 pr-32">
          {terminalLogs.map((log, idx) => (
            <div 
              key={idx} 
              className={`leading-relaxed tracking-wide ${
                log.startsWith("$") 
                  ? "text-[#FCD34D]" 
                  : log.includes("[ALERT]") 
                  ? "text-rose-400 font-semibold" 
                  : log.includes("[AI SCHEDULER]") 
                  ? "text-[#3B82F6]" 
                  : "text-[#4ADE80]"
              }`}
            >
              {log}
            </div>
          ))}
          <div className="text-[#3B82F6] flex items-center gap-1.5 animate-pulse mt-1 select-none">
            <span>&gt; Waiting for user input...</span>
            <span className="w-1.5 h-3 bg-[#3B82F6]"></span>
          </div>
          <div ref={terminalEndRef} />
        </div>
      </footer>

      {/* Modal Task Edit/Create element */}
      {isFormOpen && (
        <TaskForm
          taskToEdit={taskToEdit}
          onSubmit={handleFormSubmit}
          onCancel={() => setIsFormOpen(false)}
        />
      )}

    </div>
  );
}

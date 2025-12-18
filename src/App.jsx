import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, AlertTriangle, CheckCircle, XCircle, FileText, 
  Camera, User, Filter, MoreHorizontal, Save, Trash2, RefreshCw, 
  Calendar, Shield, Clock, FileCheck, History, Paperclip, 
  ChevronRight, X, Printer, Eye, Hash, MapPin, LogIn, LogOut, Lock,
  Download, Pencil
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, onSnapshot, doc, 
  updateDoc, deleteDoc, serverTimestamp, query, orderBy, arrayUnion
} from 'firebase/firestore';

// --- Firebase Configuration ---
const myRealFirebaseConfig = {
  apiKey: "AIzaSyBcofwp-VjJ2fvuhU7Xh1B6DZxGpFFhPtM",
  authDomain: "mf3-protocolviolation-tracker.firebaseapp.com",
  projectId: "mf3-protocolviolation-tracker",
  storageBucket: "mf3-protocolviolation-tracker.firebasestorage.app",
  messagingSenderId: "635149354872",
  appId: "1:635149354872:web:e98937cce9006f00216a8d"
};

const app = initializeApp(myRealFirebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Constants ---
const VIOLATION_TYPES = [
  "Unzipped Jumpsuit (Serious)", "Wearing Makeup/Cosmetics", "Exposed Hair/Hijab",
  "Eating/Drinking in CR", "Unauthorized Item (Cardboard/Pouch)", "Sitting on Floor (No Mat)", "Other"
];
const CLEANROOM_LEVELS = ["L1", "L2", "L3"];
const ACTIONS = ["Verbal Warning", "Written Warning", "Final Warning", "Cleanroom Ban"];
const STATUSES = [
  { id: 'training', label: 'Retraining', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { id: 'revoke_requested', label: 'Requested Security to Revoke Access', color: 'bg-red-50 text-red-600 border-red-200' },
  { id: 'revoked', label: 'Access Revoked (Confirmed)', color: 'bg-red-100 text-red-800 border-red-200' },
  { id: 'new_cert', label: 'Obtained New CR Protocol Cert', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'restore_requested', label: 'Requested Security to Restore Access', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'restored', label: 'Access Restored', color: 'bg-green-100 text-green-800 border-green-200' },
  { id: 'case_closed', label: 'Case Closed', color: 'bg-gray-100 text-gray-800 border-gray-300' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showReportPreview, setShowReportPreview] = useState(false);
  
  const [pendingStatus, setPendingStatus] = useState(null);
  const [statusNote, setStatusNote] = useState('');
  const [statusFile, setStatusFile] = useState(false);

  // --- Edit Mode States ---
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);

  const [formData, setFormData] = useState({
    name: '', badgeId: '', department: '', cleanroomLevel: CLEANROOM_LEVELS[0],
    enforcerName: '', violationType: VIOLATION_TYPES[0], description: '',
    actionTaken: ACTIONS[0], status: "", photoPlaceholder: false, violationDate: '' 
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'mf3_violations');
    const unsubscribeData = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id, ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date() 
      }));
      items.sort((a, b) => b.timestamp - a.timestamp);
      setViolations(items);
      
      // Auto-refresh selected violation if it exists in the new data
      if (selectedViolation) {
        const updatedRecord = items.find(i => i.id === selectedViolation.id);
        if (updatedRecord) {
            setSelectedViolation(updatedRecord);
        }
      }
      
      setLoading(false);
    }, (error) => {
      console.error("Error fetching data:", error);
      setLoading(false);
    });
    return () => unsubscribeData();
  }, [user, selectedViolation?.id]); // Added selectedViolation?.id dependency to ensure refresh logic works

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setLoginError("Invalid credentials. Access Denied.");
    }
  };

  const handleLogout = () => signOut(auth);
  const handlePrint = () => window.print();
  const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  
  // --- Handle Edit Mode ---
  const handleEdit = (violation) => {
    setFormData({
      name: violation.name,
      badgeId: violation.badgeId,
      department: violation.department || '',
      cleanroomLevel: violation.cleanroomLevel || CLEANROOM_LEVELS[0],
      enforcerName: violation.enforcerName,
      violationType: violation.violationType || VIOLATION_TYPES[0],
      description: violation.description,
      actionTaken: violation.actionTaken || ACTIONS[0],
      status: violation.status, // Load current status for correction
      photoPlaceholder: violation.statusHistory?.[0]?.hasFile || false, 
      violationDate: violation.violationDate
    });
    setEditId(violation.id);
    setIsEditing(true);
    setView('form');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      if (isEditing && editId) {
        // --- UPDATE EXISTING RECORD ---
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mf3_violations', editId);
        await updateDoc(docRef, {
           name: formData.name,
           badgeId: formData.badgeId,
           department: formData.department,
           cleanroomLevel: formData.cleanroomLevel,
           enforcerName: formData.enforcerName,
           violationType: formData.violationType,
           description: formData.description,
           actionTaken: formData.actionTaken,
           status: formData.status, // Update current status (correction)
           violationDate: formData.violationDate
        });
        setIsEditing(false);
        setEditId(null);
      } else {
        // --- CREATE NEW RECORD ---
        const maxCaseNumber = violations.reduce((max, v) => (v.caseNumber || 0) > max ? (v.caseNumber || 0) : max, 0);
        const nextCaseNumber = maxCaseNumber + 1;
        const caseIdString = `CR-${String(nextCaseNumber).padStart(6, '0')}`;
        const initialHistory = [{ status: formData.status, timestamp: new Date().toISOString(), note: 'Initial Violation Logged', hasFile: formData.photoPlaceholder }];
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'mf3_violations'), {
          ...formData, caseNumber: nextCaseNumber, caseId: caseIdString, timestamp: serverTimestamp(), enforcerId: user.uid, statusHistory: initialHistory, newCertAttached: false
        });
      }
      resetForm(); 
      setView('list');
    } catch (error) { alert("Failed to save violation."); }
  };

  const initiateStatusUpdate = (statusId) => { 
    // Removed the restriction: if (statusId !== selectedViolation.status)
    // Now allows selecting any status to add notes or re-confirm
    setPendingStatus(statusId); 
    setStatusNote(''); 
    setStatusFile(false); 
  };
  
  const confirmStatusUpdate = async () => {
    if (!user || !pendingStatus) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mf3_violations', selectedViolation.id);
      const historyEntry = { status: pendingStatus, timestamp: new Date().toISOString(), note: statusNote, hasFile: statusFile };
      const updateData = { status: pendingStatus, statusHistory: arrayUnion(historyEntry) };
      await updateDoc(docRef, updateData);
      setPendingStatus(null);
      // Local update handles via onSnapshot, but we can optimistically update selectedViolation too
      setSelectedViolation({...selectedViolation, status: pendingStatus, statusHistory: [...(selectedViolation.statusHistory || []), historyEntry]});
    } catch (error) { console.error(error); }
  };

  const resetForm = () => {
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setFormData({ name: '', badgeId: '', department: '', cleanroomLevel: CLEANROOM_LEVELS[0], enforcerName: '', violationType: VIOLATION_TYPES[0], description: '', actionTaken: ACTIONS[0], status: "", photoPlaceholder: false, violationDate: now.toISOString().slice(0, 16) });
    setIsEditing(false);
    setEditId(null);
  };

  const filteredViolations = useMemo(() => violations.filter(v => 
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    v.badgeId.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (v.caseId && v.caseId.toLowerCase().includes(searchTerm.toLowerCase()))
  ), [violations, searchTerm]);

  const stats = useMemo(() => ({ 
    total: violations.length, 
    pending: violations.filter(v => v.status !== 'case_closed' && v.status !== 'restored').length 
  }), [violations]);

  if (!user) {
    return (
      <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-8 border-indigo-600">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-100 p-4 rounded-2xl">
              <Shield className="h-12 w-12 text-indigo-600" />
            </div>
          </div>
          <h2 className="text-3xl font-black text-center text-slate-900 mb-1 leading-tight">MF3 Cleanroom</h2>
          <p className="text-center text-slate-500 mb-8 font-medium">Protocol Violation Tracking System</p>
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Username (Email)</label>
              <input type="email" required className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-indigo-500 outline-none transition-all" placeholder="admin@mf3.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Password</label>
              <input type="password" required className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-indigo-500 outline-none transition-all" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {loginError && <div className="text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">{loginError}</div>}
            <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black text-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2">
              <LogIn size={20} /> LOG IN
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col text-slate-900 overflow-x-hidden">
       {/* --- HIDDEN PRINT REPORT --- */}
       <div className="hidden print:block print:absolute print:inset-0 print:bg-white print:z-50 print:p-0 bg-white text-black">
         {selectedViolation ? <PrintableReport data={selectedViolation} /> : <div className="p-10 text-center">Select a record to print.</div>}
      </div>

       {/* --- PREVIEW MODAL --- */}
       {showReportPreview && selectedViolation && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fadeIn">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2"><FileText className="text-indigo-600" /> Report Preview</h2>
              <div className="flex gap-2">
                <button onClick={handlePrint} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium" title="Send to Printer">
                  <Printer size={18} /> Print Report
                </button>
                <button onClick={handlePrint} className="px-4 py-2 bg-emerald-600 text-white rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition font-medium" title="Select 'Save as PDF' in the print dialog destination">
                  <Download size={18} /> Save as PDF
                </button>
                <button onClick={() => setShowReportPreview(false)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500 transition"><X size={24} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-gray-100 pb-20">
              <div className="shadow-lg bg-white mx-auto w-[210mm] min-h-[297mm]">
                <PrintableReport data={selectedViolation} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 border-b border-slate-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
              <Shield className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight leading-none">MF3 ENFORCER</h1>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-1">Cleanroom Integrity Unit</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex gap-4">
              <div className="text-center px-4 py-1 border-r border-slate-700">
                <span className="block text-[10px] font-bold text-slate-500 uppercase">Total Cases</span>
                <span className="text-xl font-black">{stats.total}</span>
              </div>
              <div className="text-center px-4 py-1">
                <span className="block text-[10px] font-bold text-slate-500 uppercase">Active Alerts</span>
                <span className="text-xl font-black text-red-400">{stats.pending}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="bg-slate-800 hover:bg-red-600 p-3 rounded-xl transition-all group">
              <LogOut size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      {/* DASHBOARD GRID */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        {view === 'list' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT SIDE: LIST (8 COLS) */}
            <div className="lg:col-span-8 space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                  <input type="text" placeholder="Search by name, ID, or case number..." className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <button onClick={() => { resetForm(); setView('form'); }} className="w-full sm:w-auto bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex-shrink-0">
                  <Plus size={20} /> Log A New Report
                </button>
              </div>

              <div className="space-y-4">
                {filteredViolations.map(v => (
                  <div key={v.id} onClick={() => setSelectedViolation(v)} className={`bg-white p-5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md ${selectedViolation?.id === v.id ? 'border-indigo-500 shadow-indigo-50 shadow-lg scale-[1.01]' : 'border-transparent shadow-sm'}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex gap-4">
                        <div className={`p-3 rounded-xl flex-shrink-0 h-fit ${v.violationType.includes('Serious') ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                          <AlertTriangle size={24} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-black text-slate-900 text-lg uppercase tracking-tight">{v.name}</h3>
                            <span className="text-xs font-bold text-slate-400 font-mono">#{v.caseId}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 mb-3">
                            <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 tracking-wider border border-slate-200 uppercase">{v.badgeId}</span>
                            <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 tracking-wider border border-slate-200 uppercase">{v.department}</span>
                          </div>
                          <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <MapPin size={14} className="text-indigo-500" />
                            Cleanroom Level {v.cleanroomLevel} — {v.violationType}
                          </p>
                        </div>
                      </div>
                      <StatusBadge id={v.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT SIDE: DETAILS PANEL (4 COLS) */}
            <div className="lg:col-span-4 sticky top-28">
              {selectedViolation ? (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-10rem)]">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
                    <h2 className="font-black text-slate-900 flex items-center gap-2 uppercase tracking-widest text-[10px]">
                      <FileText size={16} className="text-indigo-600" /> Case Details
                    </h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowReportPreview(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-indigo-100 transition-colors" title="Generate Report">
                         <Printer size={16} /> Generate Report
                      </button>
                      <button onClick={() => handleEdit(selectedViolation)} className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="Edit Record">
                        <Pencil size={20} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <span>Reported On</span>
                      <span>Enforcer</span>
                    </div>
                    <div className="flex items-center justify-between text-sm font-bold text-slate-800 -mt-6">
                      <span className="flex items-center gap-1.5"><Calendar size={14} />{new Date(selectedViolation.violationDate).toLocaleDateString()}</span>
                      <span>{selectedViolation.enforcerName}</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Protocol Violation</label>
                      <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                        <p className="text-red-700 font-bold mb-2">{selectedViolation.violationType}</p>
                        <p className="text-xs text-slate-600 leading-relaxed italic">"{selectedViolation.description}"</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Workflow Actions</label>
                      <div className="space-y-2">
                        {STATUSES.map(s => (
                          <button 
                            key={s.id} 
                            onClick={() => initiateStatusUpdate(s.id)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all font-bold text-xs ${selectedViolation.status === s.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-600 hover:border-indigo-200'}`}
                          >
                            {s.label}
                            {selectedViolation.status === s.id && <CheckCircle size={16} />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {pendingStatus && (
                      <div className="bg-slate-900 p-5 rounded-2xl text-white space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex justify-between items-center">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Updating Status</h4>
                          <button onClick={() => setPendingStatus(null)}><X size={16}/></button>
                        </div>
                        <textarea className="w-full bg-slate-800 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-200" placeholder="Add a note for this update..." value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={3} />
                        <button onClick={confirmStatusUpdate} className="w-full bg-indigo-500 hover:bg-indigo-400 py-3 rounded-xl font-black transition-colors uppercase text-[10px] tracking-widest">Execute Status Update</button>
                      </div>
                    )}

                    <div className="pt-6 border-t border-slate-100">
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Timeline History</label>
                       <div className="space-y-6">
                         {selectedViolation.statusHistory?.slice().reverse().map((h, i) => (
                           <div key={i} className="relative pl-6 border-l-2 border-slate-200 pb-2">
                             <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-4 border-indigo-600" />
                             <p className="text-xs font-black text-slate-900 uppercase mb-1">{STATUSES.find(st => st.id === h.status)?.label}</p>
                             <p className="text-[10px] text-slate-400 font-bold mb-2 uppercase">{new Date(h.timestamp).toLocaleString()}</p>
                             {h.note && <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg italic">"{h.note}"</p>}
                           </div>
                         ))}
                       </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-[400px] bg-white rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                  <FileText size={48} className="mb-4 opacity-20" />
                  <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">Select a violation to view lifecycle</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* FORM VIEW (Used for Create AND Edit) */
          <div className="max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
              {/* ORANGE BANNER */}
              <div className="bg-orange-500 p-8 border-b border-orange-600 flex justify-between items-center text-white">
                <div className="flex items-center gap-4">
                  <div className="bg-white/20 text-white p-3 rounded-2xl"><Shield size={28}/></div>
                  {/* DYNAMIC TITLE */}
                  <h2 className="text-2xl font-black uppercase tracking-tight text-white">{isEditing ? 'Edit Protocol Violation' : 'Log Protocol Violation'}</h2>
                </div>
                <button onClick={() => setView('list')} className="text-white/70 hover:text-white transition-colors"><XCircle size={32}/></button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Violator Full Name</label>
                    <input required name="name" value={formData.name} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Employee#/IC or Passport#(Vendor)</label>
                    <input required name="badgeId" value={formData.badgeId} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all font-mono" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Department/Company(Vendor)</label>
                    <input required name="department" value={formData.department} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Cleanroom Level</label>
                    <select name="cleanroomLevel" value={formData.cleanroomLevel} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all appearance-none">
                      {CLEANROOM_LEVELS.map(l => <option key={l} value={l}>MF3 - Level {l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Violation Type</label>
                    <select name="violationType" value={formData.violationType} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all appearance-none">
                      {VIOLATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Action Taken (Penalty)</label>
                    <select name="actionTaken" value={formData.actionTaken} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all appearance-none">
                      {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Initial Workflow Status</label>
                    <select required name="status" value={formData.status} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all appearance-none">
                      <option value="" disabled>Select Status...</option>
                      {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Description of Incident</label>
                  <textarea required name="description" value={formData.description} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 outline-none transition-all h-32" placeholder="Provide details of the breach..." />
                </div>

                <div className="p-6 bg-indigo-50 rounded-2xl border-2 border-indigo-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Enforcer Name</label>
                    <input required name="enforcerName" value={formData.enforcerName} onChange={handleInputChange} className="w-full px-4 py-2 bg-white border-none rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Incident Timestamp</label>
                    <input required type="datetime-local" name="violationDate" value={formData.violationDate} onChange={handleInputChange} className="w-full px-4 py-2 bg-white border-none rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
                  </div>
                </div>

                <div className="flex flex-col items-center">
                    <p className="text-xs text-red-500 font-bold mb-4 uppercase tracking-widest animate-pulse">Reminder: Upload evident/photo into SharePoint folder</p>
                    <div className="flex w-full gap-4">
                        <button type="button" onClick={() => { resetForm(); setView('list'); }} className="flex-1 px-8 py-4 border-2 border-slate-100 text-slate-400 font-black rounded-2xl hover:bg-slate-50 transition-all uppercase tracking-widest">Cancel</button>
                        <button type="submit" className="flex-[2] bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-lg hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3">
                            <Save size={24}/> {isEditing ? 'UPDATE RECORD' : 'LOG VIOLATION'}
                        </button>
                    </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
      
      {/* Styles for A4 Printing */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 0;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

function StatusBadge({ id }) {
  const config = STATUSES.find(s => s.id === id) || STATUSES[0];
  return (
    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2 shadow-sm whitespace-nowrap ${config.color}`}>
      {config.label}
    </span>
  );
}

function PrintableReport({ data }) {
  if (!data) return null;
  return (
    <div className="w-[210mm] min-h-[297mm] mx-auto bg-white border border-gray-300 p-12 print:border-none print:shadow-none">
      <div className="text-center border-b-2 border-gray-800 pb-6 mb-8">
        <div className="flex justify-center items-center mb-4">
          <Shield className="h-10 w-10 text-blue-800 mr-2" />
          <h1 className="text-3xl font-bold uppercase tracking-widest text-blue-800">Confidential</h1>
        </div>
        <h2 className="text-xl font-bold uppercase text-blue-800">Cleanroom Protocol Violation Report</h2>
        <p className="text-sm text-gray-500 mt-1">Cleanroom Protocol Enforcing Committee (MF3)</p>
      </div>
      <div className="flex justify-between items-end mb-8 text-sm"><div><span className="font-bold text-gray-500 uppercase">Case Reference ID:</span><div className="font-mono text-lg font-bold text-gray-900">{data.caseId || data.id}</div></div><div className="text-right"><span className="font-bold text-gray-500 uppercase">Report Generated:</span><div className="text-gray-900">{new Date().toLocaleString()}</div></div></div>
      <div className="mb-8"><h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">A. Violator Information</h3><div className="grid grid-cols-2 gap-6"><div><label className="block text-xs font-bold text-gray-500 uppercase">Name</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.name}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase">Employee ID / IC / Passport</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.badgeId}</div></div><div className="col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase">Department / Company (Vendor)</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.department}</div></div></div></div>
      <div className="mb-8"><h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">B. Violation Particulars</h3><div className="grid grid-cols-2 gap-6 mb-4"><div><label className="block text-xs font-bold text-gray-500 uppercase">Date & Time of Violation</label><div className="border-b border-gray-300 py-1 text-gray-900">{data.violationDate ? new Date(data.violationDate).toLocaleString() : 'N/A'}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase">Reported By (Enforcer)</label><div className="border-b border-gray-300 py-1 text-gray-900">{data.enforcerName}</div></div></div><div className="grid grid-cols-2 gap-6 mb-4"><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Violation Type</label><div className="p-2 border border-red-200 bg-red-50 text-red-800 font-bold rounded text-sm inline-block">{data.violationType}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cleanroom Level</label><div className="p-2 border border-blue-200 bg-blue-50 text-blue-800 font-bold rounded text-sm inline-block">MF3 Cleanroom - {data.cleanroomLevel || 'N/A'}</div></div></div><div className="mb-4"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Action Taken</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.actionTaken}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description of Incident</label><div className="p-4 border border-gray-300 rounded bg-gray-50 text-gray-800 text-sm leading-relaxed min-h-[80px]">{data.description}</div></div></div>
      <div className="mb-8 avoid-break">
        <h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">C. Remarks</h3>
        <div className="border-2 border-gray-300 border-dashed rounded p-6 bg-gray-50 text-center">
            <p className="text-gray-600 font-medium italic">
                "Photographic evidence may available in SharePoint folder, please contact MF3 Cleanroom Protocol Enforcing Committee to view it"
            </p>
        </div>
      </div>
      <div className="mt-12 pt-8 border-t-2 border-gray-200 avoid-break"><div className="grid grid-cols-3 gap-8"><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Violator Signature</div><div className="text-xs text-gray-400">Acknowledging Violation</div></div><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Enforcer Signature</div><div className="text-xs text-gray-400">Verifying Report</div></div><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Manager / HOD</div><div className="text-xs text-gray-400">Acknowledging Receipt</div></div></div></div>
      <div className="mt-12 text-center text-[10px] text-gray-400"><p>This document is generated by the MF3 Cleanroom Protocol Enforcement System.</p><p>Strictly Confidential. For Internal Use Only.</p></div>
    </div>
  );
}
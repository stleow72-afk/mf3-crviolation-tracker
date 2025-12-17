import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, AlertTriangle, CheckCircle, XCircle, FileText, 
  Camera, User, Filter, MoreHorizontal, Save, Trash2, RefreshCw, 
  Calendar, Shield, Clock, FileCheck, History, Paperclip, 
  ChevronRight, X, Printer, Eye, Hash, MapPin, LogIn, LogOut, Lock
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, onSnapshot, doc, 
  updateDoc, deleteDoc, serverTimestamp, query, orderBy, arrayUnion
} from 'firebase/firestore';

// --- Firebase Configuration ---
// This contains the keys you provided for the "mf3-protocolviolation-tracker" project.
const myRealFirebaseConfig = {
  apiKey: "AIzaSyBcofwp-VjJ2fvuhU7Xh1B6DZxGpFFhPtM",
  authDomain: "mf3-protocolviolation-tracker.firebaseapp.com",
  projectId: "mf3-protocolviolation-tracker",
  storageBucket: "mf3-protocolviolation-tracker.firebasestorage.app",
  messagingSenderId: "635149354872",
  appId: "1:635149354872:web:e98937cce9006f00216a8d"
};

const hasCustomConfig = Object.keys(myRealFirebaseConfig).length > 0;
const firebaseConfig = hasCustomConfig 
  ? myRealFirebaseConfig
  : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

const app = initializeApp(firebaseConfig);
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

// --- Main Component ---
export default function CleanroomTracker() {
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

  const [formData, setFormData] = useState({
    name: '', badgeId: '', department: '', cleanroomLevel: CLEANROOM_LEVELS[0],
    enforcerName: '', violationType: VIOLATION_TYPES[0], description: '',
    actionTaken: ACTIONS[0], status: STATUSES[1].id, photoPlaceholder: false, violationDate: '' 
  });

  useEffect(() => {
    // Standard Firebase Auth Listener
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
      if (selectedViolation) {
        const updated = items.find(i => i.id === selectedViolation.id);
        if (updated) setSelectedViolation(updated);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching data:", error);
      setLoading(false);
    });
    return () => unsubscribeData();
  }, [user, selectedViolation?.id]); 

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      setLoginError("Invalid email or password. Access Denied.");
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setViolations([]);
    setSelectedViolation(null);
  };

  const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      const maxCaseNumber = violations.reduce((max, v) => (v.caseNumber || 0) > max ? (v.caseNumber || 0) : max, 0);
      const nextCaseNumber = maxCaseNumber + 1;
      const caseIdString = `CR-${String(nextCaseNumber).padStart(6, '0')}`;
      const initialHistory = [{ status: formData.status, timestamp: new Date().toISOString(), note: 'Initial Violation Logged', hasFile: formData.photoPlaceholder }];
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'mf3_violations'), {
        ...formData, caseNumber: nextCaseNumber, caseId: caseIdString, timestamp: serverTimestamp(), enforcerId: user.uid, statusHistory: initialHistory, newCertAttached: false
      });
      resetForm(); setView('list');
    } catch (error) { alert("Failed to save violation."); }
  };

  const initiateStatusUpdate = (statusId) => { if (statusId !== selectedViolation.status) { setPendingStatus(statusId); setStatusNote(''); setStatusFile(false); }};
  const cancelStatusUpdate = () => { setPendingStatus(null); setStatusNote(''); setStatusFile(false); };
  const confirmStatusUpdate = async () => {
    if (!user || !pendingStatus) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mf3_violations', selectedViolation.id);
      const historyEntry = { status: pendingStatus, timestamp: new Date().toISOString(), note: statusNote || 'Status updated via Enforcer Panel', hasFile: statusFile };
      const updateData = { status: pendingStatus, statusHistory: arrayUnion(historyEntry) };
      if (pendingStatus === 'new_cert' && statusFile) updateData.newCertAttached = true;
      await updateDoc(docRef, updateData);
      setPendingStatus(null);
    } catch (error) { console.error(error); }
  };

  const handleDelete = async (id) => { if (user && window.confirm("Delete record?")) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'mf3_violations', id)); };
  
  const resetForm = () => {
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setFormData({ name: '', badgeId: '', department: '', cleanroomLevel: CLEANROOM_LEVELS[0], enforcerName: '', violationType: VIOLATION_TYPES[0], description: '', actionTaken: ACTIONS[0], status: STATUSES[1].id, photoPlaceholder: false, violationDate: now.toISOString().slice(0, 16) });
  };
  const handlePrint = () => window.print();

  useEffect(() => { if(view === 'form' && !formData.violationDate) resetForm(); }, [view]);

  const filteredViolations = useMemo(() => violations.filter(v => v.name.toLowerCase().includes(searchTerm.toLowerCase()) || v.badgeId.toLowerCase().includes(searchTerm.toLowerCase()) || v.violationType.toLowerCase().includes(searchTerm.toLowerCase()) || (v.caseId && v.caseId.toLowerCase().includes(searchTerm.toLowerCase()))), [violations, searchTerm]);
  const stats = useMemo(() => ({ total: violations.length, active: violations.filter(v => v.status !== 'case_closed' && v.status !== 'restored').length, revoked: violations.filter(v => v.status === 'revoked' || v.status === 'revoke_requested').length }), [violations]);

  // --- LOGIN VIEW ---
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-xl shadow-xl w-full max-w-md border-t-4 border-blue-600">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-100 p-4 rounded-full">
              <Shield className="h-10 w-10 text-blue-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">MF3 Protocol Enforcer</h2>
          <p className="text-center text-gray-500 mb-8 text-sm">Authorized Personnel Only</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Access ID</label>
              <input 
                type="email" required 
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="officer@company.com"
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Passkey</label>
              <input 
                type="password" required 
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
            
            {loginError && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg flex items-center gap-2">
                <AlertTriangle size={16}/> {loginError}
              </div>
            )}

            <button type="submit" className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2">
              <LogIn size={18} /> Login
            </button>
          </form>
          <div className="mt-6 text-center text-xs text-gray-400">
            <p>Access is restricted to committee members.</p>
            <p>Contact System Admin for credentials.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading Database...</div>;

  // --- APP VIEW ---
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-slate-800 relative">
       {/* --- HIDDEN PRINT REPORT --- */}
       <div className="hidden print:block print:absolute print:inset-0 print:bg-white print:z-50 print:p-8 bg-white text-black">
         {selectedViolation ? <PrintableReport data={selectedViolation} /> : <div className="p-10 text-center">Select a record to print.</div>}
      </div>

      {/* --- PREVIEW MODAL --- */}
      {showReportPreview && selectedViolation && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fadeIn">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2"><FileText className="text-blue-600" /> Report Preview</h2>
              <div className="flex gap-2">
                <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-medium"><Printer size={18} /> Print</button>
                <button onClick={() => setShowReportPreview(false)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500 transition"><X size={24} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-gray-100"><div className="shadow-lg bg-white mx-auto"><PrintableReport data={selectedViolation} /></div></div>
          </div>
        </div>
      )}

      {/* --- MAIN HEADER --- */}
      <div className="print:hidden flex flex-col h-full flex-1">
        <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-20">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 p-2 rounded-lg shadow-blue-900"><Shield className="h-6 w-6 text-white" /></div>
              <div><h1 className="text-xl font-bold tracking-tight">MF3 CR Protocol Enforcer</h1><p className="text-xs text-slate-400 font-medium">Violation Tracking System</p></div>
            </div>
            <div className="flex items-center gap-4">
               <div className="hidden sm:flex space-x-3 text-sm">
                  <div className="bg-slate-800 px-3 py-1.5 rounded border border-slate-700 text-center"><span className="text-slate-400 block text-[10px] uppercase">Pending</span><span className="font-bold text-red-400">{stats.revoked}</span></div>
                  <div className="bg-slate-800 px-3 py-1.5 rounded border border-slate-700 text-center"><span className="text-slate-400 block text-[10px] uppercase">Total</span><span className="font-bold text-white">{stats.total}</span></div>
               </div>
               <div className="h-8 w-px bg-slate-700 mx-2"></div>
               <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs text-slate-400">Logged in as</div>
                    <div className="text-sm font-bold text-white">{user.email}</div>
                  </div>
                  <button onClick={handleLogout} className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg text-slate-300 transition" title="Logout"><LogOut size={18}/></button>
               </div>
            </div>
          </div>
        </header>

        {/* --- MAIN CONTENT --- */}
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6">
          {view === 'list' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input type="text" placeholder="Search Name, ID, or Type..." className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                </div>
                <button onClick={() => { resetForm(); setView('form'); }} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg flex items-center space-x-2 shadow-sm transition font-medium"><Plus className="h-5 w-5" /><span>Log New Violation</span></button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* LIST */}
                <div className="lg:col-span-2 space-y-3">
                  {filteredViolations.length === 0 ? (
                    <div className="bg-white p-12 rounded-xl shadow-sm text-center border border-dashed border-gray-300">
                      <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                      <h3 className="text-lg font-medium text-gray-900">No violations found</h3>
                    </div>
                  ) : (
                    filteredViolations.map((v) => (
                      <div key={v.id} onClick={() => { setSelectedViolation(v); setPendingStatus(null); }} className={`bg-white p-4 rounded-xl shadow-sm border cursor-pointer transition hover:shadow-md ${selectedViolation?.id === v.id ? 'ring-2 ring-blue-500 border-transparent' : 'border-gray-200'}`}>
                        <div className="flex justify-between items-start">
                          <div className="flex items-start space-x-4">
                            <div className={`mt-1 p-2.5 rounded-full flex-shrink-0 ${v.violationType.includes('Serious') ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}><AlertTriangle size={20} /></div>
                            <div>
                              <div className="flex items-center gap-2"><h3 className="font-bold text-gray-900 text-lg">{v.name}</h3>{v.caseId && <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200">{v.caseId}</span>}</div>
                              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mt-1"><span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono font-medium border border-gray-200">{v.badgeId}</span><span className="text-gray-300">|</span><span>{v.department}</span></div>
                              <p className="text-sm font-medium text-gray-700 mt-2">{v.violationType}</p>
                            </div>
                          </div>
                          <StatusBadge status={v.status} />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* DETAILS PANEL */}
                <div className="lg:col-span-1">
                  {selectedViolation ? (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 sticky top-24 overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
                      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2"><FileText size={18} className="text-blue-600"/>Details</h2>
                        <div className="flex items-center gap-1">
                           <button onClick={() => setShowReportPreview(true)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition flex items-center gap-1 text-xs font-medium"><Eye size={16} />Preview</button>
                           <div className="w-px h-4 bg-gray-300 mx-1"></div>
                           <button onClick={() => handleDelete(selectedViolation.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition"><Trash2 size={18} /></button>
                        </div>
                      </div>
                      <div className="p-5 space-y-6 overflow-y-auto custom-scrollbar">
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col gap-2">
                           <div className="flex justify-between items-center text-xs text-gray-500"><span className="font-semibold uppercase">Reported By</span><span className="font-semibold uppercase">Date</span></div>
                           <div className="flex justify-between items-center"><div className="flex items-center gap-1.5 font-medium text-slate-700"><User size={14} />{selectedViolation.enforcerName || 'Unknown'}</div><div className="flex items-center gap-1.5 font-medium text-red-700"><Calendar size={14} />{selectedViolation.violationDate ? new Date(selectedViolation.violationDate).toLocaleString() : 'N/A'}</div></div>
                        </div>
                        <div className="space-y-2"><label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Violation Evidence</label><div className="aspect-video bg-gray-100 rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-gray-300 text-gray-400 relative overflow-hidden group">{selectedViolation.photoPlaceholder ? (<div className="text-center"><Camera className="h-8 w-8 mb-2 mx-auto text-blue-500" /><span className="text-xs font-medium text-blue-600 block">Photo Evidence Stored</span></div>) : (<span className="text-xs">No Photo Available</span>)}</div></div>
                        <div><div className="flex justify-between items-start"><div className="text-xl font-bold text-gray-900">{selectedViolation.name}</div></div><div className="text-sm text-gray-500 mt-0.5">ID: <span className="font-mono text-gray-700">{selectedViolation.badgeId}</span></div><div className="text-sm text-gray-500 mt-0.5">{selectedViolation.department}</div>{selectedViolation.cleanroomLevel && (<div className="mt-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 text-xs font-semibold"><MapPin size={12} />MF3 Cleanroom - {selectedViolation.cleanroomLevel}</div>)}</div>
                        <div className="border-t border-gray-100 pt-4"><label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Incident Description</label><div className="text-sm font-semibold text-red-600 mb-1">{selectedViolation.violationType}</div><p className="text-sm text-gray-600 leading-relaxed bg-gray-50 p-3 rounded-md border border-gray-100">{selectedViolation.description}</p></div>
                        <div className="border-t border-gray-100 pt-4"><label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 block">Update Status Workflow</label>{pendingStatus ? (<div className="bg-blue-50 p-4 rounded-lg border border-blue-200 animate-fadeIn"><div className="flex justify-between items-center mb-3"><h3 className="text-sm font-bold text-blue-900">Updating to: {STATUSES.find(s=>s.id===pendingStatus)?.label}</h3><button onClick={cancelStatusUpdate} className="text-blue-400 hover:text-blue-600"><X size={16}/></button></div><div className="space-y-3"><div><label className="block text-xs font-medium text-blue-800 mb-1">Enforcer Updates / Notes</label><textarea className="w-full p-2 border border-blue-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Enter details..." rows="3" value={statusNote} onChange={e => setStatusNote(e.target.value)}/></div><div className="flex items-center gap-2"><label className={`flex items-center gap-2 text-sm px-3 py-2 rounded border cursor-pointer w-full transition ${statusFile ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-blue-200 text-gray-600 hover:bg-white'}`}><input type="checkbox" className="hidden" checked={statusFile} onChange={e=>setStatusFile(e.target.checked)} />{statusFile ? <CheckCircle size={16}/> : <Paperclip size={16}/>}<span className="font-medium">{statusFile ? 'File Attached' : 'Attach File / Photo'}</span></label></div><div className="flex gap-2 pt-2"><button onClick={confirmStatusUpdate} className="flex-1 bg-blue-600 text-white px-3 py-2 rounded text-sm font-semibold shadow-sm hover:bg-blue-700 transition">Confirm Update</button><button onClick={cancelStatusUpdate} className="px-3 py-2 rounded text-sm font-semibold text-gray-600 hover:bg-gray-100 transition">Cancel</button></div></div></div>) : (<div className="space-y-2">{STATUSES.map((status) => (<button key={status.id} onClick={() => initiateStatusUpdate(status.id)} disabled={selectedViolation.status === status.id} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition flex items-center justify-between border ${selectedViolation.status === status.id ? `${status.color} ring-1 ring-opacity-50 font-semibold shadow-sm cursor-default` : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600 hover:border-gray-300'}`}><span>{status.label}</span>{selectedViolation.status === status.id ? <CheckCircle size={16} /> : <ChevronRight size={16} className="text-gray-300"/>}</button>))}</div>)}</div>
                        <div className="border-t border-gray-100 pt-4"><div className="flex items-center gap-1 mb-3"><History size={14} className="text-gray-400"/><label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Action History</label></div><div className="space-y-4 pl-1">{selectedViolation.statusHistory && selectedViolation.statusHistory.slice().reverse().map((entry, idx) => (<div key={idx} className="relative pl-5 border-l-2 border-gray-200 pb-1 last:pb-0"><div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-gray-300 border border-white"></div><div className="flex flex-col gap-1"><div className="flex justify-between items-start"><p className="text-xs font-bold text-gray-800">{STATUSES.find(s => s.id === entry.status)?.label || entry.status}</p><p className="text-[10px] text-gray-400 whitespace-nowrap ml-2">{new Date(entry.timestamp).toLocaleString()}</p></div>{entry.note && (<p className="text-xs text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 italic">"{entry.note}"</p>)}{entry.hasFile && (<div className="flex items-center gap-1 text-xs text-blue-600 font-medium"><Paperclip size={12}/><span>Attachment Uploaded</span></div>)}</div></div>))}{!selectedViolation.statusHistory && (<p className="text-xs text-gray-400 italic">No history available</p>)}</div></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center text-gray-400 h-full flex flex-col items-center justify-center min-h-[400px]">
                      <div className="bg-gray-50 p-4 rounded-full mb-4"><FileText className="h-10 w-10 text-gray-300" /></div>
                      <p className="font-medium text-gray-600">No Violation Selected</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* FORM VIEW */}
          {view === 'form' && (
            <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center"><h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Shield size={20} className="text-blue-600"/>Log New Protocol Violation</h2><button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-600 transition"><XCircle size={24} /></button></div>
              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label className="block text-sm font-semibold text-gray-700 mb-1">Violator Name</label><input required name="name" value={formData.name} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition" /></div><div><label className="block text-sm font-semibold text-gray-700 mb-1">Employee#/IC/Passport</label><input required name="badgeId" value={formData.badgeId} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition" /></div><div className="md:col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Department/Vendor</label><input required name="department" value={formData.department} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition" /></div></div>
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Enforcer Name</label><input required name="enforcerName" value={formData.enforcerName} onChange={handleInputChange} className="w-full border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div><div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date & Time</label><input required type="datetime-local" name="violationDate" value={formData.violationDate} onChange={handleInputChange} className="w-full border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label className="block text-sm font-semibold text-gray-700 mb-1">MF3 Cleanroom Level</label><select name="cleanroomLevel" value={formData.cleanroomLevel} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">{CLEANROOM_LEVELS.map(l => <option key={l} value={l}>MF3 Cleanroom - {l}</option>)}</select></div><div><label className="block text-sm font-semibold text-gray-700 mb-1">Violation Type</label><select name="violationType" value={formData.violationType} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">{VIOLATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label className="block text-sm font-semibold text-gray-700 mb-1">Action Taken</label><select name="actionTaken" value={formData.actionTaken} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">{ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}</select></div><div><label className="block text-sm font-semibold text-gray-700 mb-1">Current Status</label><select name="status" value={formData.status} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">{STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Description</label><textarea required name="description" value={formData.description} onChange={handleInputChange} rows="3" className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition" /></div>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-gray-500 bg-gray-50 hover:bg-gray-100 transition cursor-pointer"><Camera className="h-8 w-8 mb-2 text-gray-400" /><p className="text-sm font-medium">Photo Evidence</p><p className="text-xs text-gray-400 mb-3">Upload photo of violation & badge</p><label className="cursor-pointer bg-white border border-gray-300 px-4 py-2 rounded-md text-sm hover:shadow-sm shadow-sm transition"><span>{formData.photoPlaceholder ? 'File Selected' : 'Choose File'}</span><input type="checkbox" className="hidden" onChange={(e) => setFormData({...formData, photoPlaceholder: e.target.checked})} /></label>{formData.photoPlaceholder && <span className="text-green-600 text-xs mt-2 font-bold flex items-center gap-1"><CheckCircle size={12}/> Image Ready</span>}</div>
                <div className="pt-4 flex justify-end space-x-3 border-t border-gray-100"><button type="button" onClick={() => setView('list')} className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition font-medium">Cancel</button><button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm flex items-center space-x-2 font-medium"><Save size={18} /><span>Log Violation</span></button></div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// --- HELPERS ---
function StatusBadge({ status }) { const config = STATUSES.find(s => s.id === status) || STATUSES[0]; return (<span className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wide font-bold border ${config.color}`}>{config.label}</span>); }

function PrintableReport({ data }) {
  if (!data) return null;
  return (
    <div className="max-w-[210mm] mx-auto border border-gray-300 p-12 min-h-screen">
      <div className="text-center border-b-2 border-gray-800 pb-6 mb-8"><div className="flex justify-center items-center mb-4"><Shield className="h-10 w-10 text-gray-800 mr-2" /><h1 className="text-3xl font-bold uppercase tracking-widest text-gray-900">Confidential</h1></div><h2 className="text-xl font-bold uppercase text-gray-800">Cleanroom Protocol Violation Report</h2><p className="text-sm text-gray-500 mt-1">Cleanroom Protocol Enforcing Committee (MF3)</p></div>
      <div className="flex justify-between items-end mb-8 text-sm"><div><span className="font-bold text-gray-500 uppercase">Case Reference ID:</span><div className="font-mono text-lg font-bold text-gray-900">{data.caseId || data.id}</div></div><div className="text-right"><span className="font-bold text-gray-500 uppercase">Report Generated:</span><div className="text-gray-900">{new Date().toLocaleString()}</div></div></div>
      <div className="mb-8"><h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">A. Violator Information</h3><div className="grid grid-cols-2 gap-6"><div><label className="block text-xs font-bold text-gray-500 uppercase">Name</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.name}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase">Employee ID / IC / Passport</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.badgeId}</div></div><div className="col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase">Department / Company (Vendor)</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.department}</div></div></div></div>
      <div className="mb-8"><h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">B. Violation Particulars</h3><div className="grid grid-cols-2 gap-6 mb-4"><div><label className="block text-xs font-bold text-gray-500 uppercase">Date & Time of Violation</label><div className="border-b border-gray-300 py-1 text-gray-900">{data.violationDate ? new Date(data.violationDate).toLocaleString() : 'N/A'}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase">Reported By (Enforcer)</label><div className="border-b border-gray-300 py-1 text-gray-900">{data.enforcerName}</div></div></div><div className="grid grid-cols-2 gap-6 mb-4"><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Violation Type</label><div className="p-2 border border-red-200 bg-red-50 text-red-800 font-bold rounded text-sm inline-block">{data.violationType}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cleanroom Level</label><div className="p-2 border border-blue-200 bg-blue-50 text-blue-800 font-bold rounded text-sm inline-block">MF3 Cleanroom - {data.cleanroomLevel || 'N/A'}</div></div></div><div className="mb-4"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Action Taken</label><div className="border-b border-gray-300 py-1 text-gray-900 font-medium">{data.actionTaken}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description of Incident</label><div className="p-4 border border-gray-300 rounded bg-gray-50 text-gray-800 text-sm leading-relaxed min-h-[80px]">{data.description}</div></div></div>
      <div className="mb-8 avoid-break"><h3 className="bg-gray-100 border border-gray-300 px-4 py-2 font-bold text-sm uppercase text-gray-800 mb-4">C. Photographic Evidence</h3><div className="border-2 border-gray-300 border-dashed rounded h-64 flex flex-col items-center justify-center bg-gray-50">{data.photoPlaceholder ? (<><Camera className="h-16 w-16 text-gray-400 mb-2" /><div className="text-gray-500 font-bold">DIGITAL EVIDENCE ON FILE</div><div className="text-xs text-gray-400 mt-1">Image Reference: {data.id}_img.jpg</div></>) : (<div className="text-gray-400 italic">No photographic evidence attached to digital record.</div>)}</div></div>
      <div className="mt-12 pt-8 border-t-2 border-gray-200 avoid-break"><div className="grid grid-cols-3 gap-8"><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Violator Signature</div><div className="text-xs text-gray-400">Acknowledging Violation</div></div><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Enforcer Signature</div><div className="text-xs text-gray-400">Verifying Report</div></div><div className="text-center"><div className="h-20 border-b border-gray-400 mb-2"></div><div className="text-xs font-bold uppercase text-gray-500">Manager / HOD</div><div className="text-xs text-gray-400">Acknowledging Receipt</div></div></div></div>
      <div className="mt-12 text-center text-[10px] text-gray-400"><p>This document is generated automatically by the MF3 Cleanroom Protocol Enforcement System.</p><p>Strictly Confidential. For Internal Use Only.</p></div>
    </div>
  );
}
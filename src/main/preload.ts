import { contextBridge, ipcRenderer } from 'electron';
import type { EchoApi, ModelDownload } from '../shared/api.ts';

// The only door between the screen and the rest of the computer. Each build
// step adds exactly the calls it needs here and nothing more.
const api: EchoApi = {
  version: () => ipcRenderer.invoke('app:version'),
  archive: {
    status: () => ipcRenderer.invoke('archive:status'),
    suggestedLocation: () => ipcRenderer.invoke('archive:suggestedLocation'),
    chooseLocation: () => ipcRenderer.invoke('archive:chooseLocation'),
    create: (location, passphrase, confirmation) => ipcRenderer.invoke('archive:create', location, passphrase, confirmation),
    findExisting: () => ipcRenderer.invoke('archive:findExisting'),
    unlock: (passphrase) => ipcRenderer.invoke('archive:unlock', passphrase),
    unlockWithRecoveryCode: (code) => ipcRenderer.invoke('archive:unlockWithRecoveryCode', code),
    setNewPassphrase: (passphrase, confirmation) => ipcRenderer.invoke('archive:setNewPassphrase', passphrase, confirmation),
    lock: () => ipcRenderer.invoke('archive:lock'),
    restoreFromBackup: () => ipcRenderer.invoke('archive:restoreFromBackup'),
    recentActivity: () => ipcRenderer.invoke('archive:recentActivity'),
  },
  settings: {
    aiKeyStatus: () => ipcRenderer.invoke('settings:aiKeyStatus'),
    testAndSaveAiKey: (key) => ipcRenderer.invoke('settings:testAndSaveAiKey', key),
    removeAiKey: () => ipcRenderer.invoke('settings:removeAiKey'),
    changePassphrase: (current, next, confirmation) => ipcRenderer.invoke('settings:changePassphrase', current, next, confirmation),
    exportEverything: () => ipcRenderer.invoke('settings:exportEverything'),
    deleteConversations: () => ipcRenderer.invoke('settings:deleteConversations'),
    doorStatus: () => ipcRenderer.invoke('settings:doorStatus'),
    turnDoorOn: () => ipcRenderer.invoke('settings:turnDoorOn'),
    turnDoorOff: () => ipcRenderer.invoke('settings:turnDoorOff'),
    doorCommand: () => ipcRenderer.invoke('settings:doorCommand'),
    doorMcpSettings: () => ipcRenderer.invoke('settings:doorMcpSettings'),
    deleteEverything: (passphrase, alsoBackup) => ipcRenderer.invoke('settings:deleteEverything', passphrase, alsoBackup),
  },
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    chooseLocation: () => ipcRenderer.invoke('backup:chooseLocation'),
    backUpNow: () => ipcRenderer.invoke('backup:backUpNow'),
    check: () => ipcRenderer.invoke('backup:check'),
  },
  people: {
    list: () => ipcRenderer.invoke('people:list'),
    add: (details) => ipcRenderer.invoke('people:add', details),
    change: (id, details) => ipcRenderer.invoke('people:change', id, details),
    remove: (id) => ipcRenderer.invoke('people:remove', id),
  },
  transcription: {
    ready: () => ipcRenderer.invoke('transcription:ready'),
    prepare: () => ipcRenderer.invoke('transcription:prepare'),
    transcribe: (samples) => ipcRenderer.invoke('transcription:transcribe', samples),
    onDownload: (listener) => {
      const handler = (_event: unknown, progress: ModelDownload) => listener(progress);
      ipcRenderer.on('transcription:download', handler);
      return () => ipcRenderer.removeListener('transcription:download', handler);
    },
  },
  interview: {
    state: () => ipcRenderer.invoke('interview:state'),
    answer: (topicId, text, audio, mimeType) => ipcRenderer.invoke('interview:answer', topicId, text, audio, mimeType),
    another: (topicId) => ipcRenderer.invoke('interview:another', topicId),
    retry: (topicId) => ipcRenderer.invoke('interview:retry', topicId),
    setDone: (topicId, done) => ipcRenderer.invoke('interview:setDone', topicId, done),
    setAudience: (topicId, index, audience) => ipcRenderer.invoke('interview:setAudience', topicId, index, audience),
  },
  advice: {
    list: () => ipcRenderer.invoke('advice:list'),
    add: (details, audio, mimeType) => ipcRenderer.invoke('advice:add', details, audio, mimeType),
    change: (id, details) => ipcRenderer.invoke('advice:change', id, details),
    audio: (id) => ipcRenderer.invoke('advice:audio', id),
    remove: (id) => ipcRenderer.invoke('advice:remove', id),
  },
  door: {
    tray: () => ipcRenderer.invoke('door:tray'),
    discard: (id) => ipcRenderer.invoke('door:discard', id),
    openFile: (id, service) => ipcRenderer.invoke('door:openFile', id, service),
    approveWords: (id, details) => ipcRenderer.invoke('door:approveWords', id, details),
    notes: () => ipcRenderer.invoke('door:notes'),
    removeNote: (id) => ipcRenderer.invoke('door:removeNote', id),
    conversations: () => ipcRenderer.invoke('door:conversations'),
    shareAiKey: (shares) => ipcRenderer.invoke('door:shareAiKey', shares),
  },
  letters: {
    list: () => ipcRenderer.invoke('letters:list'),
    readPage: (picture, mimeType) => ipcRenderer.invoke('letters:readPage', picture, mimeType),
    add: (details, pages) => ipcRenderer.invoke('letters:add', details, pages),
    change: (id, details) => ipcRenderer.invoke('letters:change', id, details),
    page: (id, page) => ipcRenderer.invoke('letters:page', id, page),
    remove: (id) => ipcRenderer.invoke('letters:remove', id),
  },
  memories: {
    list: () => ipcRenderer.invoke('memories:list'),
    change: (id, change) => ipcRenderer.invoke('memories:change', id, change),
  },
  sheets: {
    get: (kind) => ipcRenderer.invoke('sheets:get', kind),
    draft: (kind) => ipcRenderer.invoke('sheets:draft', kind),
    change: (kind, id, change) => ipcRenderer.invoke('sheets:change', kind, id, change),
    remove: (kind, id) => ipcRenderer.invoke('sheets:remove', kind, id),
    add: (kind, section, text, audience) => ipcRenderer.invoke('sheets:add', kind, section, text, audience),
  },
  chat: {
    view: (listener) => ipcRenderer.invoke('chat:view', listener),
    start: (listener) => ipcRenderer.invoke('chat:start', listener),
    say: (listener, text) => ipcRenderer.invoke('chat:say', listener, text),
    retry: (listener) => ipcRenderer.invoke('chat:retry', listener),
  },
  blindTest: {
    view: () => ipcRenderer.invoke('blindTest:view'),
    start: () => ipcRenderer.invoke('blindTest:start'),
    saveAnswer: (index, text) => ipcRenderer.invoke('blindTest:saveAnswer', index, text),
    echoNext: () => ipcRenderer.invoke('blindTest:echoNext'),
    pair: (judge) => ipcRenderer.invoke('blindTest:pair', judge),
    judge: (judge, verdict) => ipcRenderer.invoke('blindTest:judge', judge, verdict),
  },
  imports: {
    list: () => ipcRenderer.invoke('imports:list'),
    choose: (service) => ipcRenderer.invoke('imports:choose', service),
    openThread: (key) => ipcRenderer.invoke('imports:openThread', key),
    emailAddresses: (mine) => ipcRenderer.invoke('imports:emailAddresses', mine),
    iphoneBackups: () => ipcRenderer.invoke('imports:iphoneBackups'),
    chooseBackup: (folder, password) => ipcRenderer.invoke('imports:chooseBackup', folder, password),
    confirm: (token, choice) => ipcRenderer.invoke('imports:confirm', token, choice),
    messages: (id, offset, limit) => ipcRenderer.invoke('imports:messages', id, offset, limit),
    remove: (id) => ipcRenderer.invoke('imports:remove', id),
  },
  captures: {
    list: () => ipcRenderer.invoke('captures:list'),
    add: (group, label, contents, mimeType, seconds) => ipcRenderer.invoke('captures:add', group, label, contents, mimeType, seconds),
    contents: (id) => ipcRenderer.invoke('captures:contents', id),
    remove: (id) => ipcRenderer.invoke('captures:remove', id),
  },
  stories: {
    list: () => ipcRenderer.invoke('stories:list'),
    add: (details, audio, mimeType, seconds) => ipcRenderer.invoke('stories:add', details, audio, mimeType, seconds),
    change: (id, details) => ipcRenderer.invoke('stories:change', id, details),
    audio: (id) => ipcRenderer.invoke('stories:audio', id),
    picture: (id, index) => ipcRenderer.invoke('stories:picture', id, index),
    remove: (id) => ipcRenderer.invoke('stories:remove', id),
  },
  phones: {
    pair: () => ipcRenderer.invoke('phones:pair'),
    cancelPairing: () => ipcRenderer.invoke('phones:cancel-pairing'),
    list: () => ipcRenderer.invoke('phones:list'),
    unpair: (id) => ipcRenderer.invoke('phones:unpair', id),
  },
  memoryTimes: {
    view: () => ipcRenderer.invoke('memory-times:view'),
    set: (schedule) => ipcRenderer.invoke('memory-times:set', schedule),
    retire: (prompt) => ipcRenderer.invoke('memory-times:retire', prompt),
    restore: (prompt) => ipcRenderer.invoke('memory-times:restore', prompt),
  },
  consent: {
    status: () => ipcRenderer.invoke('consent:status'),
    wording: (fullName) => ipcRenderer.invoke('consent:wording', fullName),
    give: (fullName, video, mimeType, seconds) => ipcRenderer.invoke('consent:give', fullName, video, mimeType, seconds),
    video: () => ipcRenderer.invoke('consent:video'),
    withdraw: () => ipcRenderer.invoke('consent:withdraw'),
  },
  recoveryKit: {
    begin: () => ipcRenderer.invoke('recoveryKit:begin'),
    print: () => ipcRenderer.invoke('recoveryKit:print'),
    savePdf: () => ipcRenderer.invoke('recoveryKit:savePdf'),
    confirm: (first, second) => ipcRenderer.invoke('recoveryKit:confirm', first, second),
  },
};

contextBridge.exposeInMainWorld('echo', api);

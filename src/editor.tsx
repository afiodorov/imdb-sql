import React, {useRef} from 'react';
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/mode-sql";

export interface EditorProps {
    value: string;
    onChange: (text: string) => void;
    setSelection: (text: string) => void;
}

export const Editor: React.FC<EditorProps> = ({value, onChange, setSelection}) => {
    const editorRef = useRef<AceEditor | null>(null);

    return <AceEditor
        name="sql"
        ref={editorRef}
        mode="sql"
        theme="github"
        value={value}
        onChange={onChange}
        onSelectionChange={() => setSelection(editorRef.current?.editor.getSelectedText() || "")}
        fontSize={14}
        showPrintMargin={true}
        showGutter={false}
        highlightActiveLine={true}
        setOptions={{
            showLineNumbers: false,
            tabSize: 2,
            useWorker: false,
        }}
        width="100%"
        height="100%"
        readOnly={false}
        className="editor"
    />
}

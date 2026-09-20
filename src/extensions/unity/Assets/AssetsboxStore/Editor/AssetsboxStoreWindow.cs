#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace Assetsbox.Store
{
    public sealed class AssetsboxStoreWindow : EditorWindow
    {
        private const string StoreUri = "assetsbox://store";

        [MenuItem("Window/Assetsbox Store", false, 2000)]
        public static void Open()
        {
            var window = GetWindow<AssetsboxStoreWindow>();
            window.titleContent = new GUIContent("Assetsbox Store");
            window.minSize = new Vector2(360f, 190f);
        }

        private void OnGUI()
        {
            GUILayout.FlexibleSpace();
            EditorGUILayout.LabelField("Assetsbox Store", EditorStyles.boldLabel);
            EditorGUILayout.Space(6f);
            EditorGUILayout.HelpBox(
                "Browse, filter, and import 3D assets with the Assetsbox desktop app.",
                MessageType.Info);
            EditorGUILayout.Space(8f);

            if (GUILayout.Button("Open Assetsbox Store", GUILayout.Height(34f)))
            {
                Application.OpenURL(StoreUri);
            }

            GUILayout.FlexibleSpace();
        }
    }
}
#endif

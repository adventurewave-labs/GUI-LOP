{{/*
Common helpers for the gui-lop chart. Standard Helm conventions:
  - "gui-lop.name"        chart name (overridable)
  - "gui-lop.fullname"    release-prefixed name (overridable)
  - "gui-lop.chart"       chart name + version (label value)
  - "gui-lop.labels"      common labels block
  - "gui-lop.selectorLabels"  selector subset of labels
  - "gui-lop.serviceAccountName"
  - "gui-lop.secretName"  resolves to existingSecretName or generated
*/}}

{{- define "gui-lop.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "gui-lop.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "gui-lop.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "gui-lop.labels" -}}
helm.sh/chart: {{ include "gui-lop.chart" . }}
{{ include "gui-lop.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "gui-lop.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gui-lop.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "gui-lop.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "gui-lop.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "gui-lop.secretName" -}}
{{- if .Values.secrets.existingSecretName -}}
{{- .Values.secrets.existingSecretName -}}
{{- else -}}
{{- printf "%s-secrets" (include "gui-lop.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "gui-lop.configMapName" -}}
{{- printf "%s-config" (include "gui-lop.fullname" .) -}}
{{- end -}}

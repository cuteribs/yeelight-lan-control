package yeelight

const (
	DiscoveryAddress        = "239.255.255.250"
	DiscoveryPort           = 1982
	DefaultDiscoveryTimeout = 3000
	DefaultCommandTimeout   = 3000
	DefaultEffect           = "sudden"
	DefaultDuration         = 30
	DefaultControlPort      = 55443
	DefaultCacheTTL         = 10 * 60 * 1000
)

var YeelightMethods = []string{
	"get_prop",
	"set_ct_abx",
	"set_rgb",
	"set_hsv",
	"set_bright",
	"set_power",
	"toggle",
	"set_default",
	"start_cf",
	"stop_cf",
	"set_scene",
	"cron_add",
	"cron_get",
	"cron_del",
	"set_adjust",
	"set_music",
	"set_name",
	"bg_set_rgb",
	"bg_set_hsv",
	"bg_set_ct_abx",
	"bg_start_cf",
	"bg_stop_cf",
	"bg_set_scene",
	"bg_set_default",
	"bg_set_power",
	"bg_set_bright",
	"bg_set_adjust",
	"bg_toggle",
	"dev_toggle",
	"adjust_bright",
	"adjust_ct",
	"adjust_color",
	"bg_adjust_bright",
	"bg_adjust_ct",
	"bg_adjust_color",
	"udp_sess_new",
	"udp_sess_keep_alive",
	"udp_chroma_sess_new",
}

var YeelightPropertyNames = []string{
	"power",
	"bright",
	"ct",
	"rgb",
	"hue",
	"sat",
	"color_mode",
	"flowing",
	"delayoff",
	"flow_params",
	"music_on",
	"name",
	"bg_power",
	"bg_flowing",
	"bg_flow_params",
	"bg_ct",
	"bg_lmode",
	"bg_bright",
	"bg_rgb",
	"bg_hue",
	"bg_sat",
	"nl_br",
	"active_mode",
}

var LiveStatusProperties = []string{
	"power",
	"bright",
	"ct",
	"color_mode",
	"rgb",
	"hue",
	"sat",
	"name",
}

type DiscoveryOptions struct {
	TimeoutMS int
}

type CommandOptions struct {
	TimeoutMS int
}

type TransitionOptions struct {
	TimeoutMS int
	Duration  int
	Effect    string
}

type ControlConnectionOptions struct {
	Host      string
	Port      int
	Support   []string
	TimeoutMS int
}

type DiscoveredDevice struct {
	ID               string   `json:"id"`
	Host             string   `json:"host"`
	Port             int      `json:"port"`
	Model            string   `json:"model"`
	FirmwareVersion  string   `json:"firmwareVersion"`
	Name             string   `json:"name"`
	Power            string   `json:"power"`
	Brightness       string   `json:"brightness"`
	ColorMode        string   `json:"colorMode"`
	ColorTemperature string   `json:"colorTemperature"`
	RGB              string   `json:"rgb"`
	Hue              string   `json:"hue"`
	Saturation       string   `json:"saturation"`
	Support          []string `json:"support"`
	Location         string   `json:"location"`
}

type Notification struct {
	Method string            `json:"method"`
	Params map[string]string `json:"params"`
}

type ErrorPayload struct {
	Code    int64  `json:"code"`
	Message string `json:"message"`
}

type RawCommandResponse struct {
	ID     uint64        `json:"id"`
	Result any           `json:"result,omitempty"`
	Error  *ErrorPayload `json:"error,omitempty"`
}

type FlowTuple struct {
	Duration   int `json:"duration"`
	Mode       int `json:"mode"`
	Value      int `json:"value"`
	Brightness int `json:"brightness"`
}

type FlowExpression struct {
	Serialized string
	Tuples     []FlowTuple
}

type Scene struct {
	Class          string
	RGBValue       int
	Brightness     int
	Hue            int
	Saturation     int
	CTValue        int
	Count          int
	Action         int
	FlowExpression FlowExpression
	Minutes        int
}

type CronEntry struct {
	Type  int `json:"type"`
	Delay int `json:"delay"`
	Mix   int `json:"mix"`
}

type PropertyValues map[string]*string

type HostValue struct {
	Host string
	Port int
}

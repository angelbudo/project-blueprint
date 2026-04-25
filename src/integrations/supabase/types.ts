export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      player_profiles: {
        Row: {
          accept_threshold: number
          aggressiveness: number
          bluff_rate: number
          bot_difficulty: string
          bot_honesty: string
          created_at: string
          device_id: string
          envit_accepted: number
          envit_called: number
          envit_called_bluff: number
          envit_rejected: number
          envit_strength_n: number
          envit_strength_sum: number
          games_played: number
          truc_accepted: number
          truc_called: number
          truc_called_bluff: number
          truc_rejected: number
          truc_strength_n: number
          truc_strength_sum: number
          updated_at: string
        }
        Insert: {
          accept_threshold?: number
          aggressiveness?: number
          bluff_rate?: number
          bot_difficulty?: string
          bot_honesty?: string
          created_at?: string
          device_id: string
          envit_accepted?: number
          envit_called?: number
          envit_called_bluff?: number
          envit_rejected?: number
          envit_strength_n?: number
          envit_strength_sum?: number
          games_played?: number
          truc_accepted?: number
          truc_called?: number
          truc_called_bluff?: number
          truc_rejected?: number
          truc_strength_n?: number
          truc_strength_sum?: number
          updated_at?: string
        }
        Update: {
          accept_threshold?: number
          aggressiveness?: number
          bluff_rate?: number
          bot_difficulty?: string
          bot_honesty?: string
          created_at?: string
          device_id?: string
          envit_accepted?: number
          envit_called?: number
          envit_called_bluff?: number
          envit_rejected?: number
          envit_strength_n?: number
          envit_strength_sum?: number
          games_played?: number
          truc_accepted?: number
          truc_called?: number
          truc_called_bluff?: number
          truc_rejected?: number
          truc_strength_n?: number
          truc_strength_sum?: number
          updated_at?: string
        }
        Relationships: []
      }
      room_actions: {
        Row: {
          action: Json
          created_at: string
          id: number
          room_id: string
          seat: number
        }
        Insert: {
          action: Json
          created_at?: string
          id?: number
          room_id: string
          seat: number
        }
        Update: {
          action?: Json
          created_at?: string
          id?: number
          room_id?: string
          seat?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_actions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_chat: {
        Row: {
          created_at: string
          id: number
          phrase_id: string
          room_id: string
          seat: number
        }
        Insert: {
          created_at?: string
          id?: number
          phrase_id: string
          room_id: string
          seat: number
        }
        Update: {
          created_at?: string
          id?: number
          phrase_id?: string
          room_id?: string
          seat?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_chat_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_players: {
        Row: {
          device_id: string
          id: string
          is_online: boolean
          joined_at: string
          last_seen: string
          name: string
          room_id: string
          seat: number
        }
        Insert: {
          device_id: string
          id?: string
          is_online?: boolean
          joined_at?: string
          last_seen?: string
          name: string
          room_id: string
          seat: number
        }
        Update: {
          device_id?: string
          id?: string
          is_online?: boolean
          joined_at?: string
          last_seen?: string
          name?: string
          room_id?: string
          seat?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_text_chat: {
        Row: {
          created_at: string
          device_id: string
          id: number
          room_id: string
          seat: number
          text: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: number
          room_id: string
          seat: number
          text: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: number
          room_id?: string
          seat?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_text_chat_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          bot_intents: Json
          code: string
          created_at: string
          host_device: string
          id: string
          initial_mano: number
          match_state: Json | null
          paused_at: string | null
          seat_kinds: Database["public"]["Enums"]["seat_kind"][]
          status: Database["public"]["Enums"]["room_status"]
          target_cames: number
          turn_started_at: string | null
          updated_at: string
        }
        Insert: {
          bot_intents?: Json
          code: string
          created_at?: string
          host_device: string
          id?: string
          initial_mano?: number
          match_state?: Json | null
          paused_at?: string | null
          seat_kinds: Database["public"]["Enums"]["seat_kind"][]
          status?: Database["public"]["Enums"]["room_status"]
          target_cames?: number
          turn_started_at?: string | null
          updated_at?: string
        }
        Update: {
          bot_intents?: Json
          code?: string
          created_at?: string
          host_device?: string
          id?: string
          initial_mano?: number
          match_state?: Json | null
          paused_at?: string | null
          seat_kinds?: Database["public"]["Enums"]["seat_kind"][]
          status?: Database["public"]["Enums"]["room_status"]
          target_cames?: number
          turn_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_rooms: { Args: never; Returns: Json }
    }
    Enums: {
      room_status: "lobby" | "playing" | "finished" | "abandoned"
      seat_kind: "human" | "bot" | "empty"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      room_status: ["lobby", "playing", "finished", "abandoned"],
      seat_kind: ["human", "bot", "empty"],
    },
  },
} as const
